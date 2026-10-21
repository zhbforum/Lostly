import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getConversationMessages } from '../api/conversations-api';
import { advanceSessionGeneration } from '@/shared/api/session-events';
import { deferred } from '@/test/deferred';
import { historyPage, message } from '@/test/fixtures/conversations';
import type { ConversationMessagesResponse } from './types';
import { createMessageHistory, mergeMessages } from './message-history';

vi.mock('../api/conversations-api');
beforeEach(() => vi.resetAllMocks());

describe('message history consistency', () => {
  it('aborts a hidden-tab catch-up without losing already merged pages or accepting its late response', async () => {
    const late = deferred<ConversationMessagesResponse>();
    vi.mocked(getConversationMessages)
      .mockResolvedValueOnce(historyPage([message(50)]))
      .mockResolvedValueOnce(historyPage([message(51), message(100)], true))
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce(historyPage([message(101)]));
    const history = createMessageHistory('A');
    await history.loadInitial();
    const controller = new AbortController();
    const catchUp = history.catchUp(controller.signal);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(history.getSnapshot().caughtUpThroughSequence).toBe(100);
    controller.abort();
    late.resolve(historyPage([message(101)]));
    await expect(catchUp).rejects.toMatchObject({ name: 'AbortError' });
    expect(history.getSnapshot().caughtUpThroughSequence).toBe(100);
    await history.catchUp();
    expect(getConversationMessages).toHaveBeenLastCalledWith(
      'A',
      { after: 100, limit: 100 },
      expect.any(AbortSignal),
    );
    expect(history.getSnapshot().caughtUpThroughSequence).toBe(101);
  });
  it('merges by server ID/sequence without conflating identical bodies', () => {
    const one = message(1, { body: 'Hello' });
    const two = message(2, { body: 'Hello' });
    expect(mergeMessages([two, one], [one, message(3)])).toEqual([one, two, message(3)]);
    expect(mergeMessages([one], [message(1, { id: 'canonical-id' })])).toHaveLength(1);
  });

  it('keeps POST sequence 53 separate from cursor 50, then fetches 51, 52 and 53', async () => {
    vi.mocked(getConversationMessages)
      .mockResolvedValueOnce(historyPage([message(50)], true))
      .mockResolvedValueOnce(historyPage([message(51), message(52), message(53)]));
    const history = createMessageHistory('A');
    await history.loadInitial();
    history.acceptSentMessage(message(53));
    expect(history.getSnapshot().caughtUpThroughSequence).toBe(50);
    await history.catchUp();
    expect(vi.mocked(getConversationMessages).mock.calls[1][1]).toEqual({ after: 50, limit: 100 });
    expect(history.getSnapshot().messages.map(({ sequence }) => sequence)).toEqual([
      50, 51, 52, 53,
    ]);
    expect(history.getSnapshot().caughtUpThroughSequence).toBe(53);
  });

  it('immediately drains multiple pages and keeps the last successful cursor after a failure', async () => {
    vi.mocked(getConversationMessages)
      .mockResolvedValueOnce(historyPage([message(50)], true))
      .mockResolvedValueOnce(historyPage([message(51), message(100)], true))
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(historyPage([message(101), message(150)], true))
      .mockResolvedValueOnce(historyPage([message(151)]));
    const history = createMessageHistory('A');
    await history.loadInitial();
    await expect(history.catchUp()).rejects.toThrow('Offline');
    expect(history.getSnapshot().caughtUpThroughSequence).toBe(100);
    await history.catchUp();
    expect(vi.mocked(getConversationMessages).mock.calls.map(([, query]) => query?.after)).toEqual([
      undefined,
      50,
      100,
      100,
      150,
    ]);
    expect(history.getSnapshot().caughtUpThroughSequence).toBe(151);
  });

  it('deduplicates overlapping initial/POST data without advancing past the initial GET boundary', async () => {
    const response = deferred<ConversationMessagesResponse>();
    vi.mocked(getConversationMessages).mockReturnValueOnce(response.promise);
    const history = createMessageHistory('A');
    const initial = history.loadInitial();
    history.acceptSentMessage(message(53));
    response.resolve(historyPage([message(50)]));
    await initial;
    expect(history.getSnapshot().messages.map(({ sequence }) => sequence)).toEqual([50, 53]);
    expect(history.getSnapshot().caughtUpThroughSequence).toBe(50);
  });

  it('starts empty history at zero and does not let older pages alter catch-up state', async () => {
    vi.mocked(getConversationMessages)
      .mockResolvedValueOnce(historyPage([]))
      .mockResolvedValueOnce(historyPage([message(1)]));
    const empty = createMessageHistory('A');
    await empty.loadInitial();
    await empty.catchUp();
    expect(vi.mocked(getConversationMessages).mock.calls[1][1]?.after).toBe(0);

    vi.mocked(getConversationMessages)
      .mockResolvedValueOnce(historyPage([message(50)], true))
      .mockResolvedValueOnce(historyPage([message(1), message(49)]));
    const older = createMessageHistory('A');
    await older.loadInitial();
    await older.loadOlder();
    expect(vi.mocked(getConversationMessages).mock.calls[3][1]?.before).toBe(50);
    expect(older.getSnapshot()).toMatchObject({ caughtUpThroughSequence: 50, hasOlder: false });
    expect(older.getSnapshot().messages.map(({ sequence }) => sequence)).toEqual([1, 49, 50]);
  });

  it('allows only one in-flight catch-up chain', async () => {
    const page = deferred<ConversationMessagesResponse>();
    vi.mocked(getConversationMessages)
      .mockResolvedValueOnce(historyPage([message(1)]))
      .mockReturnValueOnce(page.promise);
    const history = createMessageHistory('A');
    await history.loadInitial();
    const first = history.catchUp();
    expect(history.catchUp()).toBe(first);
    await Promise.resolve();
    expect(getConversationMessages).toHaveBeenCalledTimes(2);
    page.resolve(historyPage([message(2)]));
    await first;
  });

  it('does not let a late replay of an old send skip unloaded older history', async () => {
    vi.mocked(getConversationMessages)
      .mockResolvedValueOnce(historyPage([message(100), message(149)], true))
      .mockResolvedValueOnce(historyPage([message(50), message(99)], true));
    const history = createMessageHistory('A');
    await history.loadInitial();
    history.acceptSentMessage(message(20));
    await history.loadOlder();
    expect(vi.mocked(getConversationMessages).mock.calls[1][1]?.before).toBe(100);
    expect(history.getSnapshot()).toMatchObject({
      oldestLoadedSequence: 50,
      caughtUpThroughSequence: 149,
    });
    expect(history.getSnapshot().messages.map(({ sequence }) => sequence)).toEqual([
      20, 50, 99, 100, 149,
    ]);
  });

  it.each(['initial', 'catch-up', 'older'] as const)(
    'ignores late A %s responses after opening B, even if transport ignores abort',
    async (kind) => {
      const lateA = deferred<ConversationMessagesResponse>();
      const a = createMessageHistory('A');
      if (kind !== 'initial') {
        vi.mocked(getConversationMessages).mockResolvedValueOnce(historyPage([message(5)], true));
        await a.loadInitial();
      }
      vi.mocked(getConversationMessages).mockReturnValueOnce(lateA.promise);
      const request =
        kind === 'initial' ? a.loadInitial() : kind === 'older' ? a.loadOlder() : a.catchUp();
      await Promise.resolve();
      const signal = vi.mocked(getConversationMessages).mock.calls.at(-1)![2];
      const before = a.getSnapshot();
      const ignored = (async () => {
        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
      })();
      a.dispose();
      expect(signal?.aborted).toBe(true);
      const b = createMessageHistory('B');
      vi.mocked(getConversationMessages).mockResolvedValueOnce(
        historyPage([message(1, { conversationId: 'B' })]),
      );
      await b.loadInitial();
      lateA.resolve(historyPage([message(kind === 'older' ? 4 : 6)]));
      await ignored;
      expect(a.getSnapshot()).toBe(before);
      expect(b.getSnapshot().messages).toEqual([message(1, { conversationId: 'B' })]);
    },
  );

  it('ignores an old session response and rejects a cross-conversation merge', async () => {
    const page = deferred<ConversationMessagesResponse>();
    vi.mocked(getConversationMessages).mockReturnValueOnce(page.promise);
    const history = createMessageHistory('A');
    expect(() => history.acceptSentMessage(message(1, { conversationId: 'B' }))).toThrow(
      'different conversation',
    );
    const initial = history.loadInitial();
    await Promise.resolve();
    advanceSessionGeneration();
    page.resolve(historyPage([message(1)]));
    await expect(initial).rejects.toMatchObject({ name: 'AbortError' });
    expect(history.getSnapshot().initialized).toBe(false);
  });

  it('does not loop forever on a malformed non-advancing catch-up response', async () => {
    vi.mocked(getConversationMessages)
      .mockResolvedValueOnce(historyPage([]))
      .mockResolvedValueOnce(historyPage([], true));
    const history = createMessageHistory('A');
    await history.loadInitial();
    await expect(history.catchUp()).rejects.toThrow('did not advance');
    expect(history.getSnapshot().caughtUpThroughSequence).toBe(0);
  });
});
