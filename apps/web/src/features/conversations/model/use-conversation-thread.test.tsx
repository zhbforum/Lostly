import { type ReactNode, StrictMode, useEffect } from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, assert, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/features/auth/model/auth-context';
import { ApiError } from '@/shared/api/client';
import { advanceSessionGeneration } from '@/shared/api/session-events';
import { deferred } from '@/test/deferred';
import { conversationDetail, historyPage, message } from '@/test/fixtures/conversations';
import * as api from '../api/conversations-api';
import { ConversationSendProvider } from './ConversationSendProvider';
import { useConversationSend } from './conversation-send-context';
import { useConversationThread } from './use-conversation-thread';
import type { ConversationResponse, ConversationMessagesResponse } from './types';
import { attachment, renewed } from '@/test/fixtures/conversation-attachments';

vi.mock('../api/conversations-api');
const unavailable = vi.fn(() => true);
const activity = vi.fn();
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
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.mocked(api.getConversation).mockResolvedValue({ conversation: conversationDetail() });
  vi.mocked(api.getConversationMessages).mockResolvedValue(historyPage([]));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  advanceSessionGeneration();
});

const flush = () => act(async () => {});

it('replaces loaded history when moderation changes the content version', async () => {
  vi.mocked(api.getConversation).mockResolvedValue({
    conversation: conversationDetail({ contentVersion: 1 }),
  });
  vi.mocked(api.getConversationMessages).mockResolvedValue(
    historyPage([message(1, { body: 'Removed text' })]),
  );
  const { result } = renderHook(() => useConversationThread('A', unavailable, activity), {
    wrapper: Wrapper,
  });
  await flush();
  expect(result.current.history.messages[0]?.body).toBe('Removed text');
  vi.mocked(api.getConversation).mockResolvedValue({
    conversation: conversationDetail({ contentVersion: 2 }),
  });
  vi.mocked(api.getConversationMessages).mockResolvedValue(
    historyPage([message(1, { body: null, isHidden: true, attachments: [] })]),
  );
  act(() => result.current.refreshContext());
  await flush();
  expect(result.current.history.messages[0]).toMatchObject({ body: null, isHidden: true });
  expect(result.current.context?.contentVersion).toBe(2);
});

it('attachment refresh updates only capabilities, not sequence/read/unread/activity state', async () => {
  const images = [attachment()];
  const persisted = message(5, { body: null, attachments: images });
  vi.mocked(api.getConversationMessages).mockResolvedValueOnce(historyPage([persisted]));
  const { result } = renderHook(() => useConversationThread('A', unavailable, activity), {
    wrapper: Wrapper,
  });

  await flush();

  const before = result.current;
  const replacement = renewed(images, 30 * 60_000);
  vi.mocked(api.refreshMessageAttachments).mockResolvedValueOnce({ attachments: replacement });

  await act(() => result.current.attachmentResource(persisted.id).recover(true));

  expect(result.current.history).toEqual({
    ...before.history,
    messages: [{ ...persisted, attachments: replacement }],
  });
  expect(result.current.context).toBe(before.context);
  expect(result.current.sentVersion).toBe(before.sentVersion);
  expect(activity).not.toHaveBeenCalled();
  expect(api.readConversation).not.toHaveBeenCalled();
  expect(api.getUnreadConversationCount).not.toHaveBeenCalled();
  expect(api.sendConversationMessage).not.toHaveBeenCalled();
});

it('keeps POST #53 separate from catch-up #50, merging incoming 51/52 and replay 53', async () => {
  vi.mocked(api.getConversationMessages).mockImplementation(async (_id, query) =>
    historyPage(
      query?.after === undefined
        ? [message(50)]
        : [message(51), message(52), message(53, { senderUserId: 'me' })],
    ),
  );
  vi.mocked(api.sendConversationMessage).mockResolvedValue({
    message: message(53, { senderUserId: 'me' }),
  });
  const { result } = renderHook(
    () => ({
      thread: useConversationThread('A', unavailable, activity),
      send: useConversationSend(),
    }),
    { wrapper: Wrapper },
  );

  await flush();
  await act(async () => {
    const started = result.current.send.sendMessage('A', { body: 'Hello', images: [] });
    assert(started.accepted);
    await started.completion;
  });

  expect(result.current.thread.history.caughtUpThroughSequence).toBe(50);

  await act(() => vi.advanceTimersByTimeAsync(4_000));

  expect(api.getConversationMessages).toHaveBeenLastCalledWith(
    'A',
    { after: 50, limit: 100 },
    expect.any(AbortSignal),
  );
  expect(result.current.thread.history.messages.map((m) => m.sequence)).toEqual([50, 51, 52, 53]);
  expect(result.current.thread.history.caughtUpThroughSequence).toBe(53);
});

it('ignores a context response started before read and then refreshes from a new revision', async () => {
  const old = deferred<ConversationResponse>();
  const { result } = renderHook(() => useConversationThread('A', unavailable, activity), {
    wrapper: Wrapper,
  });

  await flush();

  vi.mocked(api.getConversation)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue({ conversation: conversationDetail({ unreadCount: 0 }) });

  await act(() => vi.advanceTimersByTimeAsync(12_000));
  act(() => result.current.applyRead({ lastReadSequence: 5, unreadCount: 0 }));
  await act(async () => old.resolve({ conversation: conversationDetail({ unreadCount: 8 }) }));

  expect(result.current.context?.unreadCount).toBe(0);
  expect(api.getConversation).toHaveBeenLastCalledWith('A', expect.any(AbortSignal));
});

it('isolates A context/history from B and aborts A requests', async () => {
  const a = deferred<ConversationResponse>();
  const history = deferred<ConversationMessagesResponse>();
  vi.mocked(api.getConversation).mockImplementation((id) =>
    id === 'A' ? a.promise : Promise.resolve({ conversation: conversationDetail({ id: 'B' }) }),
  );
  vi.mocked(api.getConversationMessages).mockImplementation((id) =>
    id === 'A'
      ? history.promise
      : Promise.resolve(historyPage([message(1, { conversationId: 'B' })])),
  );
  let thread!: ReturnType<typeof useConversationThread>;

  function Probe({ id }: { id: string }) {
    const value = useConversationThread(id, unavailable, activity);
    useEffect(() => {
      thread = value;
    }, [value]);
    return null;
  }

  const view = render(
    <Wrapper>
      <Probe key="A" id="A" />
    </Wrapper>,
  );

  await flush();

  const signal = vi.mocked(api.getConversationMessages).mock.calls.at(-1)![2]!;

  view.rerender(
    <Wrapper>
      <Probe key="B" id="B" />
    </Wrapper>,
  );
  await flush();

  expect(signal.aborted).toBe(true);

  await act(async () => {
    a.resolve({ conversation: conversationDetail() });
    history.resolve(historyPage([message(90)]));
  });

  expect(thread.context?.id).toBe('B');
  expect(thread.history.messages.map((m) => m.conversationId)).toEqual(['B']);
});

it('pauses catch-up while hidden and stops both polls after an authoritative 404', async () => {
  const { result } = renderHook(() => useConversationThread('A', unavailable, activity), {
    wrapper: Wrapper,
  });

  await flush();

  const count = vi.mocked(api.getConversationMessages).mock.calls.length;
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(() => vi.advanceTimersByTimeAsync(20_000));

  expect(api.getConversationMessages).toHaveBeenCalledTimes(count);

  vi.mocked(api.getConversationMessages).mockRejectedValue(
    new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Gone'),
  );
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);

  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await flush();

  expect(result.current.unavailable).toBe(true);

  const calls = [
    vi.mocked(api.getConversation).mock.calls.length,
    vi.mocked(api.getConversationMessages).mock.calls.length,
  ];

  await act(() => vi.advanceTimersByTimeAsync(60_000));

  expect([
    vi.mocked(api.getConversation).mock.calls.length,
    vi.mocked(api.getConversationMessages).mock.calls.length,
  ]).toEqual(calls);
});

it('loads older history with retry and trusts canSendMessages for approved archived items', async () => {
  const context = conversationDetail();
  vi.mocked(api.getConversation).mockResolvedValue({
    conversation: {
      ...context,
      claim: { ...context.claim, status: 'approved' },
      listing: { ...context.listing, status: 'archived' },
      canSendMessages: true,
    },
  });
  vi.mocked(api.getConversationMessages).mockImplementation(async (_id, query) =>
    historyPage(query?.before ? [message(49)] : [message(50)], !query?.before),
  );
  const { result } = renderHook(() => useConversationThread('A', unavailable, activity), {
    wrapper: Wrapper,
  });

  await flush();

  vi.mocked(api.getConversationMessages).mockRejectedValueOnce(new Error('Offline'));

  await act(() => result.current.loadOlder());

  expect(result.current.olderError).toBeTruthy();

  await act(() => result.current.loadOlder());

  expect(result.current.history.messages.map((m) => m.sequence)).toEqual([49, 50]);
  expect(result.current.history.caughtUpThroughSequence).toBe(50);
  expect(result.current.context?.canSendMessages).toBe(true);
});

it.each([false, true])(
  'ignores obsolete history requests after read-target reconciliation (rejected: %s)',
  async (rejected) => {
    vi.mocked(api.getConversationMessages).mockResolvedValue(historyPage([message(5)], true));
    const { result } = renderHook(() => useConversationThread('A', unavailable, activity), {
      wrapper: Wrapper,
    });

    await flush();

    const older = deferred<ConversationMessagesResponse>();
    const catchUp = deferred<ConversationMessagesResponse>();
    vi.mocked(api.getConversationMessages).mockImplementation((_id, query) =>
      query?.before ? older.promise : catchUp.promise,
    );
    let loadingOlder!: Promise<boolean>;

    act(() => {
      loadingOlder = result.current.loadOlder();
    });
    await flush();

    const olderSignal = vi.mocked(api.getConversationMessages).mock.calls.at(-1)![2]!;

    await act(() => vi.advanceTimersByTimeAsync(4000));

    const catchUpSignal = vi.mocked(api.getConversationMessages).mock.calls.at(-1)![2]!;

    expect(api.getConversationMessages).toHaveBeenLastCalledWith(
      'A',
      { after: 5, limit: 100 },
      expect.any(AbortSignal),
    );

    vi.mocked(api.getConversationMessages).mockResolvedValue(historyPage([message(6)]));

    await act(() => result.current.reconcileReadTarget());

    expect(olderSignal.aborted).toBe(true);
    expect(catchUpSignal.aborted).toBe(true);
    expect(result.current.history.messages.map((item) => item.sequence)).toEqual([6]);
    expect(result.current.loadingOlder).toBe(false);

    await act(async () => {
      if (rejected) {
        older.reject(new TypeError('Old page failed'));
        catchUp.reject(new TypeError('Old poll failed'));
      } else {
        older.resolve(historyPage([message(4)]));
        catchUp.resolve(historyPage([message(7)]));
      }
      expect(await loadingOlder).toBe(false);
    });

    expect(result.current.history.messages.map((item) => item.sequence)).toEqual([6]);
    expect(result.current.history.caughtUpThroughSequence).toBe(6);
    expect(result.current.historyError).toBeNull();
    expect(result.current.olderError).toBeNull();
    expect(result.current.unavailable).toBe(false);
    expect(unavailable).not.toHaveBeenCalled();
  },
);

it('can retry a failed replacement history after a missing read target', async () => {
  vi.mocked(api.getConversationMessages).mockResolvedValue(historyPage([message(5)]));
  const { result } = renderHook(() => useConversationThread('A', unavailable, activity), {
    wrapper: Wrapper,
  });

  await flush();

  vi.mocked(api.getConversationMessages)
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValue(historyPage([message(6)]));

  await act(() => result.current.reconcileReadTarget());

  expect(result.current.history.messages).toEqual([]);
  expect(result.current.historyError).toBe('Could not load message history.');
  expect(result.current.unavailable).toBe(false);

  act(() => result.current.refreshMessages());
  await flush();

  expect(result.current.history.messages.map((item) => item.sequence)).toEqual([6]);
  expect(result.current.historyError).toBeNull();
  expect(api.getConversationMessages).toHaveBeenLastCalledWith(
    'A',
    { limit: 50 },
    expect.any(AbortSignal),
  );
});
