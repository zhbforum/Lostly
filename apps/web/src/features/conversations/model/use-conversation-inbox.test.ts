import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { advanceSessionGeneration } from '@/shared/api/session-events';
import { deferred } from '@/test/deferred';
import { conversation, inboxPage } from '@/test/fixtures/conversations';
import { getConversationInbox } from '../api/conversations-api';
import type { ConversationInboxResponse } from './types';
import { useConversationInbox } from './use-conversation-inbox';
import type { Claim } from '@/features/claims/model/types';

vi.mock('../api/conversations-api');

beforeEach(() => {
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

const flush = () => act(async () => {});

it('immediately reconciles a deferred initial inbox invalidated by an unavailable thread', async () => {
  const stale = deferred<ConversationInboxResponse>();
  const fresh = deferred<ConversationInboxResponse>();
  vi.mocked(getConversationInbox)
    .mockReturnValueOnce(stale.promise)
    .mockReturnValueOnce(fresh.promise);
  const { result } = renderHook(useConversationInbox);

  await flush();

  expect(getConversationInbox).toHaveBeenCalledTimes(1);
  expect(result.current).toMatchObject({ initialized: false, refreshing: true });

  // This is the workspace action for the cold-open detail's CONVERSATION_NOT_FOUND.
  act(() => result.current.removeConversation('A'));
  await act(async () => stale.resolve(inboxPage([conversation('A'), conversation('stale-row')])));

  // No timer advancement: a new head request must already be in flight.
  expect(getConversationInbox).toHaveBeenCalledTimes(2);
  expect(getConversationInbox).toHaveBeenLastCalledWith(
    { limit: 20, cursor: undefined },
    expect.any(AbortSignal),
  );
  expect(result.current).toMatchObject({ initialized: false, refreshing: true, conversations: [] });
  expect(result.current.unavailableIds.has('A')).toBe(true);

  await act(async () => fresh.resolve(inboxPage([conversation('B')])));

  expect(result.current).toMatchObject({ initialized: true, refreshing: false, error: null });
  expect(result.current.conversations.map(({ id }) => id)).toEqual(['B']);
});

it.each(['approved', 'rejected'] as const)(
  'reconciles %s across loaded pages and ignores a pre-decision head response',
  async (status) => {
    const stale = deferred<ConversationInboxResponse>();
    vi.mocked(getConversationInbox)
      .mockResolvedValueOnce(inboxPage([conversation('A')], 'page-2'))
      .mockResolvedValueOnce(inboxPage([conversation('B')], 'page-3'))
      .mockReturnValueOnce(stale.promise)
      // B is outside page one; it must retain the local lifecycle patch.
      .mockResolvedValueOnce(
        inboxPage(
          [
            conversation('A', {
              claim: { id: 'claim-A', status },
              canSendMessages: status === 'approved',
            }),
          ],
          'new-page-2',
        ),
      )
      .mockResolvedValueOnce(inboxPage([]));
    const { result } = renderHook(useConversationInbox);

    await flush();
    await act(() => result.current.loadMore());
    await act(() => vi.advanceTimersByTimeAsync(15_000));

    const claim: Claim = {
      id: 'claim-A',
      conversationId: 'A',
      listingId: 'listing-1',
      status,
      verificationDetails: 'Private proof',
      handoverDetails: status === 'approved' ? 'Library reception' : null,
      createdAt: '2026-09-25T10:00:00Z',
      updatedAt: '2026-09-25T10:00:00Z',
      reviewedAt: '2026-09-25T10:00:00Z',
    };

    act(() => result.current.applyDecision(claim));

    expect(result.current.conversations.find((row) => row.id === 'A')?.claim.status).toBe(status);
    expect(result.current.conversations.find((row) => row.id === 'B')).toMatchObject({
      claim: { status: status === 'approved' ? 'rejected' : 'pending' },
      canSendMessages: status !== 'approved',
    });

    await act(async () => stale.resolve(inboxPage([conversation('A'), conversation('B')])));

    expect(result.current.conversations.find((row) => row.id === 'A')?.claim.status).toBe(status);
    expect(result.current.conversations.find((row) => row.id === 'B')?.claim.status).toBe(
      status === 'approved' ? 'rejected' : 'pending',
    );

    await act(() => result.current.loadMore());

    expect(getConversationInbox).toHaveBeenLastCalledWith(
      { limit: 20, cursor: 'page-3' },
      expect.any(AbortSignal),
    );
  },
);

it('applies authoritative read counts before discarding stale inbox responses and reconciling', async () => {
  const old = deferred<ConversationInboxResponse>();
  vi.mocked(getConversationInbox)
    .mockResolvedValueOnce(inboxPage([conversation('A', { unreadCount: 3 })]))
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue(inboxPage([conversation('A', { unreadCount: 0 })]));
  const { result } = renderHook(useConversationInbox);

  await flush();
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  act(() => result.current.applyRead('A', 0));

  expect(result.current.conversations[0]!.unreadCount).toBe(0);

  await act(async () => old.resolve(inboxPage([conversation('A', { unreadCount: 3 })])));

  expect(result.current.conversations[0]!.unreadCount).toBe(0);
});

it('appends/deduplicates and preserves the continuation cursor through a first-page poll', async () => {
  vi.mocked(getConversationInbox)
    .mockResolvedValueOnce(inboxPage([conversation('A')], 'page-2'))
    .mockResolvedValueOnce(inboxPage([conversation('B'), conversation('A')], 'page-3'))
    .mockResolvedValueOnce(inboxPage([conversation('C'), conversation('A')], 'new-page-2'))
    .mockResolvedValueOnce(inboxPage([conversation('D')]));
  const { result } = renderHook(useConversationInbox);

  await flush();
  await act(() => result.current.loadMore());
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  await act(() => result.current.loadMore());

  expect(vi.mocked(getConversationInbox).mock.calls.map(([query]) => query?.cursor)).toEqual([
    undefined,
    'page-2',
    undefined,
    'page-3',
  ]);
  expect(result.current.conversations.map(({ id }) => id)).toEqual(['D', 'C', 'B', 'A']);
  expect(result.current.hasMore).toBe(false);
});

it.each(['empty', 'exhausted', 'more'] as const)(
  'loads conversations beyond a new head page after an %s inbox',
  async (previous) => {
    const newRows = Array.from({ length: 25 }, (_, i) =>
      conversation(`new-${i}`, { lastActivityAt: '2026-09-25T12:00:00.000Z' }),
    );
    const oldRows = previous === 'empty' ? [] : [conversation('A')];
    vi.mocked(getConversationInbox)
      .mockResolvedValueOnce(inboxPage(oldRows, previous === 'more' ? 'old-tail' : null))
      .mockResolvedValueOnce(inboxPage(newRows.slice(0, 20), 'new-tail'))
      .mockResolvedValueOnce(inboxPage([...newRows.slice(20), ...oldRows]))
      .mockResolvedValueOnce(inboxPage(newRows.slice(0, 20), 'new-tail'));
    const { result } = renderHook(useConversationInbox);

    await flush();
    await act(async () => result.current.refresh());

    expect(result.current.hasMore).toBe(true);

    await act(() => result.current.loadMore());

    expect(getConversationInbox).toHaveBeenLastCalledWith(
      { limit: 20, cursor: 'new-tail' },
      expect.any(AbortSignal),
    );
    expect(result.current.conversations).toHaveLength(25 + oldRows.length);
    expect(result.current.hasMore).toBe(false);

    await act(async () => result.current.refresh());

    expect(result.current.hasMore).toBe(false);
    expect(result.current.conversations).toHaveLength(25 + oldRows.length);
  },
);

it('keeps loaded rows across refresh failures and empty head pages; retries initial and append errors', async () => {
  vi.mocked(getConversationInbox)
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce(inboxPage([conversation('A')], 'page-2'))
    .mockRejectedValueOnce(new Error('Append failed'))
    .mockResolvedValueOnce(inboxPage([conversation('B')]))
    .mockRejectedValueOnce(new Error('Refresh failed'))
    .mockResolvedValueOnce(inboxPage([]));
  const { result } = renderHook(useConversationInbox);

  await flush();

  expect(result.current).toMatchObject({
    initialized: false,
    refreshing: false,
    error: 'Could not load your conversations.',
  });

  await act(async () => result.current.refresh());

  expect(result.current.error).toBeNull();

  await act(() => result.current.loadMore());

  expect(result.current.moreError).toBe('Could not load more conversations.');

  await act(() => result.current.loadMore());

  expect(result.current.moreError).toBeNull();

  await act(async () => result.current.refresh());

  expect(result.current.error).toMatch(/Could not refresh/);

  await act(async () => result.current.refresh());

  expect(result.current.conversations.map(({ id }) => id)).toEqual(['B', 'A']);
});

it('serializes load-more and polling and single-flights repeated load-more clicks', async () => {
  const more = deferred<ConversationInboxResponse>();
  vi.mocked(getConversationInbox)
    .mockResolvedValueOnce(inboxPage([conversation('A')], 'page-2'))
    .mockReturnValueOnce(more.promise)
    .mockResolvedValueOnce(inboxPage([conversation('A', { unreadCount: 3 })]));
  const { result } = renderHook(useConversationInbox);

  await flush();

  let pending!: Promise<void>;

  act(() => {
    pending = result.current.loadMore();
    expect(result.current.loadMore()).toBe(pending);
  });
  await act(() => vi.advanceTimersByTimeAsync(15_000));

  expect(getConversationInbox).toHaveBeenCalledTimes(2);

  await act(async () => {
    more.resolve(inboxPage([conversation('B')]));
    await pending;
  });

  expect(getConversationInbox).toHaveBeenCalledTimes(3);
  expect(result.current.conversations.find(({ id }) => id === 'A')?.unreadCount).toBe(3);
});

it('does not resurrect a removed conversation from a stale in-flight response and accepts a fresh restore', async () => {
  const stale = deferred<ConversationInboxResponse>();
  vi.mocked(getConversationInbox)
    .mockResolvedValueOnce(inboxPage([conversation('A')]))
    .mockReturnValueOnce(stale.promise)
    .mockResolvedValueOnce(inboxPage([]))
    .mockResolvedValueOnce(inboxPage([conversation('A')]));
  const { result } = renderHook(useConversationInbox);

  await flush();
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  act(() => result.current.removeConversation('A'));
  await act(async () => stale.resolve(inboxPage([conversation('A', { unreadCount: 5 })])));

  expect(result.current.conversations).toEqual([]);
  expect(result.current.unavailableIds.has('A')).toBe(true);

  await act(async () => result.current.refresh());

  expect(result.current.conversations).toHaveLength(1);
  expect(result.current.unavailableIds.has('A')).toBe(false);
});

it('aborts and ignores old-session responses and unmounted requests', async () => {
  const old = deferred<ConversationInboxResponse>();
  vi.mocked(getConversationInbox)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(inboxPage([conversation('B')]));
  const { result, unmount } = renderHook(useConversationInbox);

  await flush();

  const oldSignal = vi.mocked(getConversationInbox).mock.calls[0][1];

  await act(async () => advanceSessionGeneration());

  expect(oldSignal?.aborted).toBe(true);

  await act(async () => old.resolve(inboxPage([conversation('A')])));

  expect(result.current.conversations.map(({ id }) => id)).toEqual(['B']);

  unmount();
  await act(() => vi.advanceTimersByTimeAsync(60_000));

  expect(getConversationInbox).toHaveBeenCalledTimes(2);
});
