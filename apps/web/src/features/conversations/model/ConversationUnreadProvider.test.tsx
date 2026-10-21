import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext, type AuthStatus } from '@/features/auth/model/auth-context';
import { advanceSessionGeneration } from '@/shared/api/session-events';
import { deferred } from '@/test/deferred';
import { getUnreadConversationCount } from '../api/conversations-api';
import { ConversationUnreadProvider } from './ConversationUnreadProvider';
import { useConversationUnread } from './use-conversation-unread';
import type { UnreadConversationsResponse } from './types';

vi.mock('../api/conversations-api');
let status: AuthStatus = 'authenticated';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider
      value={{
        status,
        user: null,
        login: async () => {},
        register: async () => {},
        logout: async () => {},
        updateProfile: () => {},
      }}
    >
      <ConversationUnreadProvider>{children}</ConversationUnreadProvider>
    </AuthContext.Provider>
  );
}

beforeEach(() => {
  status = 'authenticated';
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  advanceSessionGeneration();
});

it('polls one global count for multiple consumers and preserves it on a temporary failure', async () => {
  vi.mocked(getUnreadConversationCount)
    .mockResolvedValueOnce({ unreadConversationCount: 3 })
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({ unreadConversationCount: 1 });
  const { result } = renderHook(() => [useConversationUnread(), useConversationUnread()], {
    wrapper,
  });

  await act(async () => {});

  expect(result.current.map((value) => value.unreadConversationCount)).toEqual([3, 3]);
  expect(getUnreadConversationCount).toHaveBeenCalledOnce();

  await act(() => vi.advanceTimersByTimeAsync(30_000));

  expect(result.current[0].unreadConversationCount).toBe(3);

  await act(() => vi.advanceTimersByTimeAsync(30_000));

  expect(result.current[0].unreadConversationCount).toBe(1);
});

it('invalidates an old unread response on refresh and queues a fresh request', async () => {
  const old = deferred<UnreadConversationsResponse>();
  const fresh = deferred<UnreadConversationsResponse>();
  vi.mocked(getUnreadConversationCount)
    .mockResolvedValueOnce({ unreadConversationCount: 1 })
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(fresh.promise);
  const { result } = renderHook(useConversationUnread, { wrapper });

  await act(async () => {});
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  act(() => result.current.refreshUnread());

  expect(vi.mocked(getUnreadConversationCount).mock.calls[1][0]?.aborted).toBe(true);

  await act(async () => old.resolve({ unreadConversationCount: 9 }));

  expect(result.current.unreadConversationCount).toBe(1);

  await act(async () => fresh.resolve({ unreadConversationCount: 0 }));

  expect(result.current.unreadConversationCount).toBe(0);
});

it('does not poll guests and resets across session generations while ignoring delayed results', async () => {
  status = 'unauthenticated';

  const old = deferred<UnreadConversationsResponse>();
  vi.mocked(getUnreadConversationCount)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ unreadConversationCount: 2 });
  const { result, rerender } = renderHook(useConversationUnread, { wrapper });

  expect(getUnreadConversationCount).not.toHaveBeenCalled();

  status = 'authenticated';
  rerender();
  await act(async () => advanceSessionGeneration());
  await act(async () => old.resolve({ unreadConversationCount: 99 }));

  expect(result.current.unreadConversationCount).toBe(2);

  status = 'unauthenticated';
  rerender();

  expect(result.current.unreadConversationCount).toBe(0);

  await act(() => vi.advanceTimersByTimeAsync(60_000));

  expect(getUnreadConversationCount).toHaveBeenCalledTimes(2);
});
