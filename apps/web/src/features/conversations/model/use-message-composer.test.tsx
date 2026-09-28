import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/features/auth/model/auth-context';
import { ApiError } from '@/shared/api/client';
import { advanceSessionGeneration } from '@/shared/api/session-events';
import * as uuid from '@/shared/lib/random-uuid';
import { readDraft } from '@/shared/model/form-drafts';
import { deferred } from '@/test/deferred';
import { message } from '@/test/fixtures/conversations';
import { sendConversationMessage } from '../api/conversations-api';
import { ConversationSendProvider } from './ConversationSendProvider';
import { useMessageComposer } from './use-message-composer';

vi.mock('../api/conversations-api');
const auth = {
  user: { id: 'me', email: 'me@example.com', displayName: 'Me', role: 'user' as const },
  status: 'authenticated' as const,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
};
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <AuthContext.Provider value={auth}>
        <ConversationSendProvider>{children}</ConversationSendProvider>
      </AuthContext.Provider>
    </StrictMode>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.spyOn(uuid, 'randomUuid');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  advanceSessionGeneration();
});

it('keeps the exact draft on a synchronous start failure and permits another send', async () => {
  vi.mocked(uuid.randomUuid).mockImplementationOnce(() => {
    throw new Error('UUID generation failed');
  });
  vi.mocked(sendConversationMessage).mockResolvedValueOnce({ message: message(1) });
  const { result } = renderHook(() => useMessageComposer('A', true), { wrapper: Wrapper });
  const original = '  Original A\r\nwith details  ';
  act(() => result.current.setDraft(original));

  await act(async () => {
    await expect(result.current.submit()).resolves.toBeUndefined();
  });
  expect(result.current.draft).toBe(original);
  expect(readDraft('conversation:A')).toBe(original);
  expect(result.current.error).toBe(
    'Could not start sending this message. Your draft has been kept.',
  );
  expect(result.current.operations).toEqual([]);
  expect(sendConversationMessage).not.toHaveBeenCalled();

  await act(() => result.current.submit());
  expect(sendConversationMessage).toHaveBeenCalledExactlyOnceWith(
    'A',
    'Original A\nwith details',
    expect.any(String),
  );
  expect(uuid.randomUuid).toHaveBeenCalledTimes(2);
  expect(result.current.draft).toBe('');
  expect(result.current.error).toBeNull();
});

it('keeps the exact draft without a start error when a stale session declines the send', async () => {
  const { result } = renderHook(() => useMessageComposer('A', true), { wrapper: Wrapper });
  const original = '  Original A\r\nwith details  ';
  act(() => result.current.setDraft(original));
  const staleSubmit = result.current.submit;
  act(() => advanceSessionGeneration());

  await act(() => staleSubmit());
  expect(result.current.draft).toBe(original);
  expect(readDraft('conversation:A')).toBe(original);
  expect(result.current.error).toBeNull();
  expect(result.current.operations).toEqual([]);
  expect(uuid.randomUuid).not.toHaveBeenCalled();
  expect(sendConversationMessage).not.toHaveBeenCalled();
});

it('clears an accepted draft and leaves an uncertain outgoing body only in the registry', async () => {
  const response = deferred<Awaited<ReturnType<typeof sendConversationMessage>>>();
  vi.mocked(sendConversationMessage).mockReturnValueOnce(response.promise);
  const { result } = renderHook(() => useMessageComposer('A', true), { wrapper: Wrapper });
  act(() => result.current.setDraft('  Original A\r\nwith details  '));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.submit();
  });
  const operation = result.current.operations[0]!;
  expect(operation).toMatchObject({ status: 'sending', body: 'Original A\nwith details' });
  expect(result.current.draft).toBe('');
  expect(readDraft('conversation:A')).toBe('');

  await act(async () => {
    response.reject(new TypeError('Response lost after commit'));
    await pending;
  });
  expect(result.current.operations).toEqual([
    { ...operation, status: 'uncertain', mayBePersisted: true },
  ]);
  expect(result.current.draft).toBe('');
  expect(readDraft('conversation:A')).toBe('');
  expect(result.current.error).toBeNull();
  expect(sendConversationMessage).toHaveBeenCalledExactlyOnceWith(
    'A',
    operation.body,
    operation.operationId,
  );
  expect(uuid.randomUuid).toHaveBeenCalledOnce();
});

it.each([
  ['uncertain', new TypeError('Response lost')],
  ['rate-limited', new ApiError(429, 'RATE_LIMITED', 'Slow down', 2)],
] as const)(
  'blocks edits and new UUIDs while %s, even after the retry deadline',
  async (status, error) => {
    vi.mocked(sendConversationMessage).mockRejectedValueOnce(error);
    const { result } = renderHook(() => useMessageComposer('A', true), { wrapper: Wrapper });
    act(() => result.current.setDraft('  Original A\r\n  '));
    await act(() => result.current.submit());
    const operation = result.current.operations[0]!;
    expect(operation).toMatchObject({ status, body: 'Original A' });
    expect(result.current.hasUnresolvedOperation).toBe(true);

    for (const elapsed of [0, 3_000]) {
      await act(() => vi.advanceTimersByTimeAsync(elapsed));
      act(() => result.current.setDraft('New B'));
      await act(() => result.current.submit());
      expect(result.current.draft).toBe('');
      expect(result.current.operations).toEqual([operation]);
      expect(sendConversationMessage).toHaveBeenCalledTimes(1);
      expect(uuid.randomUuid).toHaveBeenCalledTimes(1);
    }

    vi.mocked(sendConversationMessage).mockResolvedValueOnce({
      message: message(1, { senderUserId: 'me', body: 'Original A' }),
    });
    await act(() => result.current.retry(operation.operationId));
    expect(sendConversationMessage).toHaveBeenLastCalledWith(
      'A',
      'Original A',
      operation.operationId,
    );
    expect(uuid.randomUuid).toHaveBeenCalledTimes(1);
    expect(result.current.hasUnresolvedOperation).toBe(false);
    act(() => result.current.setDraft('New B'));
    expect(result.current.draft).toBe('New B');
  },
);

it('also locks the draft while the first send is in flight', async () => {
  const response = deferred<Awaited<ReturnType<typeof sendConversationMessage>>>();
  vi.mocked(sendConversationMessage).mockReturnValueOnce(response.promise);
  const { result } = renderHook(() => useMessageComposer('A', true), { wrapper: Wrapper });
  act(() => result.current.setDraft('Original A'));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.submit();
    result.current.setDraft('New B');
    void result.current.submit();
  });
  expect(result.current.hasUnresolvedOperation).toBe(true);
  expect(result.current.draft).toBe('');
  await act(async () => {
    response.resolve({ message: message(1) });
    await pending;
  });
  expect(sendConversationMessage).toHaveBeenCalledTimes(1);
  expect(uuid.randomUuid).toHaveBeenCalledTimes(1);
  expect(result.current.hasUnresolvedOperation).toBe(false);
});

it('confirms an uncertain operation with the same UUID/body after context becomes read-only', async () => {
  vi.mocked(sendConversationMessage)
    .mockRejectedValueOnce(new TypeError('Response lost'))
    .mockResolvedValueOnce({ message: message(1, { senderUserId: 'me', body: 'Original A' }) });
  const { result, rerender } = renderHook(({ canSend }) => useMessageComposer('A', canSend), {
    wrapper: Wrapper,
    initialProps: { canSend: true },
  });
  act(() => result.current.setDraft('Original A'));
  await act(() => result.current.submit());
  const operation = result.current.operations[0]!;
  rerender({ canSend: false });
  await act(() => result.current.retry(operation.operationId));
  expect(sendConversationMessage).toHaveBeenNthCalledWith(
    2,
    'A',
    'Original A',
    operation.operationId,
  );
  expect(uuid.randomUuid).toHaveBeenCalledTimes(1);
  expect(result.current.operations).toEqual([]);
  expect(result.current.draft).toBe('');
});

it('restores the original body to the memory draft on a definitive read-only retry rejection', async () => {
  vi.mocked(sendConversationMessage)
    .mockRejectedValueOnce(new TypeError('Request lost before commit'))
    .mockRejectedValueOnce(new ApiError(409, 'CONVERSATION_READ_ONLY', 'Read-only'));
  const { result, rerender, unmount } = renderHook(
    ({ canSend }) => useMessageComposer('A', canSend),
    {
      wrapper: Wrapper,
      initialProps: { canSend: true },
    },
  );
  act(() => result.current.setDraft('  Original A\r\nwith details  '));
  await act(() => result.current.submit());
  const operation = result.current.operations[0]!;
  act(() => result.current.setDraft('Must not replace A'));
  rerender({ canSend: false });
  await act(() => result.current.retry(operation.operationId));
  expect(result.current.operations).toEqual([]);
  expect(result.current.draft).toBe('Original A\nwith details');
  expect(result.current.error).toContain('Your draft has been kept');
  expect(sendConversationMessage).toHaveBeenNthCalledWith(
    2,
    'A',
    operation.body,
    operation.operationId,
  );
  expect(uuid.randomUuid).toHaveBeenCalledTimes(1);
  expect(readDraft('conversation:A')).toBe(operation.body);
  unmount();
  const reopened = renderHook(() => useMessageComposer('A', false), { wrapper: Wrapper });
  expect(reopened.result.current.draft).toBe(operation.body);
});
