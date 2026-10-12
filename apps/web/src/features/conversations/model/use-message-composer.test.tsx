import { StrictMode, useLayoutEffect, type ReactNode } from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/features/auth/model/auth-context';
import { ApiError } from '@/shared/api/client';
import { advanceSessionGeneration } from '@/shared/api/session-events';
import * as uuid from '@/shared/lib/random-uuid';
import { clearDrafts } from '@/shared/model/form-drafts';
import { readConversationDraft } from './message-drafts';
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
  updateProfile: () => {},
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
  clearDrafts();
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
  act(() => result.current.setText(original));

  await act(async () => {
    await expect(result.current.submit()).resolves.toBeUndefined();
  });
  expect(result.current.draft.text).toBe(original);
  expect(readConversationDraft('A').text).toBe(original);
  expect(result.current.error).toBe(
    'Could not start sending this message. Your draft has been kept.',
  );
  expect(result.current.operations).toEqual([]);
  expect(sendConversationMessage).not.toHaveBeenCalled();

  await act(() => result.current.submit());
  expect(sendConversationMessage).toHaveBeenCalledExactlyOnceWith(
    'A',
    { body: 'Original A\nwith details', images: [] },
    expect.any(String),
  );
  expect(uuid.randomUuid).toHaveBeenCalledTimes(2);
  expect(result.current.draft.text).toBe('');
  expect(result.current.error).toBeNull();
});

it('invalidates the draft when the session changes, ignoring a stale submit', async () => {
  const { result } = renderHook(() => useMessageComposer('A', true), { wrapper: Wrapper });
  const original = '  Original A\r\nwith details  ';
  act(() => result.current.setText(original));
  const staleSubmit = result.current.submit;
  act(() => advanceSessionGeneration());

  await act(() => staleSubmit());
  expect(result.current.draft).toEqual({ text: '', images: [] });
  expect(readConversationDraft('A')).toEqual({ text: '', images: [] });
  expect(result.current.error).toBeNull();
  expect(result.current.operations).toEqual([]);
  expect(uuid.randomUuid).not.toHaveBeenCalled();
  expect(sendConversationMessage).not.toHaveBeenCalled();
});

it('clears an accepted draft and leaves an uncertain outgoing body only in the registry', async () => {
  const response = deferred<Awaited<ReturnType<typeof sendConversationMessage>>>();
  vi.mocked(sendConversationMessage).mockReturnValueOnce(response.promise);
  const { result } = renderHook(() => useMessageComposer('A', true), { wrapper: Wrapper });
  act(() => result.current.setText('  Original A\r\nwith details  '));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.submit();
  });
  const operation = result.current.operations[0]!;
  expect(operation).toMatchObject({ status: 'sending', body: 'Original A\nwith details' });
  expect(result.current.draft.text).toBe('');
  expect(readConversationDraft('A').text).toBe('');

  await act(async () => {
    response.reject(new TypeError('Response lost after commit'));
    await pending;
  });
  expect(result.current.operations).toEqual([
    { ...operation, status: 'uncertain', mayBePersisted: true },
  ]);
  expect(result.current.draft.text).toBe('');
  expect(readConversationDraft('A').text).toBe('');
  expect(result.current.error).toBeNull();
  expect(sendConversationMessage).toHaveBeenCalledExactlyOnceWith(
    'A',
    { body: operation.body, images: [] },
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
    act(() => result.current.setText('  Original A\r\n  '));
    await act(() => result.current.submit());
    const operation = result.current.operations[0]!;
    expect(operation).toMatchObject({ status, body: 'Original A' });
    expect(result.current.hasUnresolvedOperation).toBe(true);

    for (const elapsed of [0, 3_000]) {
      await act(() => vi.advanceTimersByTimeAsync(elapsed));
      act(() => result.current.setText('New B'));
      await act(() => result.current.submit());
      expect(result.current.draft.text).toBe('');
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
      { body: 'Original A', images: [] },
      operation.operationId,
    );
    expect(uuid.randomUuid).toHaveBeenCalledTimes(1);
    expect(result.current.hasUnresolvedOperation).toBe(false);
    act(() => result.current.setText('New B'));
    expect(result.current.draft.text).toBe('New B');
  },
);

it('also locks the draft while the first send is in flight', async () => {
  const response = deferred<Awaited<ReturnType<typeof sendConversationMessage>>>();
  vi.mocked(sendConversationMessage).mockReturnValueOnce(response.promise);
  const { result } = renderHook(() => useMessageComposer('A', true), { wrapper: Wrapper });
  act(() => result.current.setText('Original A'));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.submit();
    result.current.setText('New B');
    void result.current.submit();
  });
  expect(result.current.hasUnresolvedOperation).toBe(true);
  expect(result.current.draft.text).toBe('');
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
  act(() => result.current.setText('Original A'));
  await act(() => result.current.submit());
  const operation = result.current.operations[0]!;
  rerender({ canSend: false });
  await act(() => result.current.retry(operation.operationId));
  expect(sendConversationMessage).toHaveBeenNthCalledWith(
    2,
    'A',
    { body: 'Original A', images: [] },
    operation.operationId,
  );
  expect(uuid.randomUuid).toHaveBeenCalledTimes(1);
  expect(result.current.operations).toEqual([]);
  expect(result.current.draft.text).toBe('');
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
  act(() => result.current.setText('  Original A\r\nwith details  '));
  await act(() => result.current.submit());
  const operation = result.current.operations[0]!;
  act(() => result.current.setText('Must not replace A'));
  rerender({ canSend: false });
  await act(() => result.current.retry(operation.operationId));
  expect(result.current.operations).toEqual([]);
  expect(result.current.draft.text).toBe('Original A\nwith details');
  expect(result.current.error).toContain('Your draft has been kept');
  expect(sendConversationMessage).toHaveBeenNthCalledWith(
    2,
    'A',
    { body: operation.body, images: [] },
    operation.operationId,
  );
  expect(uuid.randomUuid).toHaveBeenCalledTimes(1);
  expect(readConversationDraft('A').text).toBe(operation.body);
  unmount();
  const reopened = renderHook(() => useMessageComposer('A', false), { wrapper: Wrapper });
  expect(reopened.result.current.draft.text).toBe(operation.body);
});

it.each(['send', 'retry'] as const)(
  'recovers a rejected %s after leaving the composer without changing another conversation draft',
  async (attempt) => {
    const response = deferred<Awaited<ReturnType<typeof sendConversationMessage>>>();
    if (attempt === 'retry')
      vi.mocked(sendConversationMessage).mockRejectedValueOnce(new TypeError('Request lost'));
    vi.mocked(sendConversationMessage).mockReturnValueOnce(response.promise);
    let composer!: ReturnType<typeof useMessageComposer>;
    function Composer({ id }: { id: string }) {
      const current = useMessageComposer(id, true);
      useLayoutEffect(() => {
        composer = current;
      });
      return null;
    }
    const page = render(<Composer key="A" id="A" />, { wrapper: Wrapper });
    const imageA = new File(['A'], 'A.jpg', { type: 'image/jpeg' });
    const imageB = new File(['B'], 'B.webp', { type: 'image/webp' });
    act(() => composer.addImages([imageA, imageB]));
    act(() => composer.setText('Original A'));
    let pending!: Promise<unknown>;
    if (attempt === 'retry') {
      await act(() => composer.submit());
      act(() => {
        pending = composer.retry(composer.operations[0]!.operationId);
      });
    } else {
      act(() => {
        pending = composer.submit();
      });
    }
    expect(composer.draft.text).toBe('');
    page.rerender(<Composer key="B" id="B" />);
    act(() => composer.setText('Draft B'));
    await act(async () => {
      response.reject(new ApiError(409, 'CONVERSATION_READ_ONLY', 'Read-only'));
      await pending;
    });
    expect(composer.draft.text).toBe('Draft B');
    expect(readConversationDraft('A').text).toBe('Original A');
    expect(readConversationDraft('A').images[0]).toBe(imageA);
    expect(readConversationDraft('A').images[1]).toBe(imageB);
    page.rerender(<Composer key="A" id="A" />);
    expect(composer.operations).toEqual([]);
    expect(composer.draft.text).toBe('Original A');
    expect(composer.draft.images[0]).toBe(imageA);
    expect(composer.draft.images[1]).toBe(imageB);
  },
);

it('rejects a whole invalid batch without changing the existing files array, and preserves duplicates/order', () => {
  const { result } = renderHook(() => useMessageComposer('A', true), { wrapper: Wrapper });
  const a = new File(['A'], 'private.jpg', { type: 'image/jpeg' });
  const b = new File(['B'], 'private.webp', { type: 'image/webp' });
  act(() => result.current.addImages([a, b]));
  const original = result.current.draft;
  for (const batch of [
    [a, b, a],
    [a, new File([], 'empty'), b],
  ]) {
    act(() => result.current.addImages(batch));
    expect(result.current.draft).toBe(original);
    expect(result.current.draft.images[0]).toBe(a);
    expect(result.current.draft.images[1]).toBe(b);
    expect(result.current.selectionError).not.toBeNull();
  }
  act(() => result.current.addImages([a, a]));
  expect(result.current.draft.images).toEqual([a, b, a, a]);
  act(() => result.current.removeImage(1));
  expect(result.current.draft.images).toHaveLength(3);
  result.current.draft.images.forEach((file) => expect(file).toBe(a));
});

it.each(['\0', '\ud800', 'x'.repeat(2001)])(
  'never submits invalid text even with images',
  async (text) => {
    const { result } = renderHook(() => useMessageComposer('A', true), { wrapper: Wrapper });
    const file = new File(['A'], 'private.jpg');
    act(() => {
      result.current.setText(text);
      result.current.addImages([file]);
    });
    expect(result.current.canSubmit).toBe(false);
    await act(() => result.current.submit());
    expect(sendConversationMessage).not.toHaveBeenCalled();
    expect(result.current.draft.images[0]).toBe(file);
  },
);

it('keeps the whole draft on synchronous failure, accepts image-only, and locks all edits until settled', async () => {
  const pending = deferred<Awaited<ReturnType<typeof sendConversationMessage>>>();
  vi.mocked(sendConversationMessage).mockReturnValueOnce(pending.promise);
  vi.mocked(uuid.randomUuid).mockImplementationOnce(() => {
    throw new Error('Cannot start');
  });
  const { result } = renderHook(() => useMessageComposer('A', true), { wrapper: Wrapper });
  const file = new File(['A'], 'private.jpg');
  act(() => {
    result.current.setText(' \r\n ');
    result.current.addImages([file]);
  });
  const original = result.current.draft;
  expect(result.current.canSubmit).toBe(true);
  await act(() => result.current.submit());
  expect(result.current.draft).toBe(original);
  expect(sendConversationMessage).not.toHaveBeenCalled();
  let completion!: Promise<void>;
  act(() => {
    completion = result.current.submit();
  });
  expect(result.current.draft).toEqual({ text: '', images: [] });
  const operation = result.current.operations[0];
  expect(operation.body).toBeNull();
  expect(operation.images[0]).toBe(file);
  expect(operation.images).not.toBe(original.images);
  act(() => {
    result.current.addImages([file]);
    result.current.removeImage(0);
    result.current.setText('Changed');
  });
  expect(result.current.draft).toEqual({ text: '', images: [] });
  await act(async () => {
    pending.reject(new ApiError(429, 'RATE_LIMITED', 'Busy'));
    await completion;
  });
  act(() => result.current.addImages([file]));
  expect(result.current.draft.images).toHaveLength(0);
  expect(result.current.operations[0].images).toBe(operation.images);
});

it('keeps the whole draft if admission declines in the same session generation', async () => {
  function GuestWrapper({ children }: { children: ReactNode }) {
    return (
      <AuthContext.Provider value={{ ...auth, status: 'unauthenticated' }}>
        <ConversationSendProvider>{children}</ConversationSendProvider>
      </AuthContext.Provider>
    );
  }
  const { result } = renderHook(() => useMessageComposer('A', true), { wrapper: GuestWrapper });
  const file = new File(['A'], 'private.jpg');
  act(() => {
    result.current.setText(' raw\r\n ');
    result.current.addImages([file]);
  });
  const original = result.current.draft;
  await act(() => result.current.submit());
  expect(result.current.draft).toBe(original);
  expect(readConversationDraft('A')).toBe(original);
  expect(sendConversationMessage).not.toHaveBeenCalled();
});
