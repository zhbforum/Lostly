import { afterEach, describe, expect, it, vi } from 'vitest';
import { conversationDetail, historyPage, inboxPage, message } from '@/test/fixtures/conversations';
import {
  getConversation,
  getConversationInbox,
  getConversationMessages,
  getUnreadConversationCount,
  readConversation,
  sendConversationMessage,
} from './conversations-api';

afterEach(() => vi.unstubAllGlobals());

describe('conversation API', () => {
  it('encodes IDs/cursors, preserves after=0, and forwards cancellation to GETs', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json(historyPage([]))));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    await getConversationInbox({ cursor: 'a+/= b', limit: 20 }, signal);
    await getConversation('a/b', signal);
    await getConversationMessages('a/b', { after: 0, limit: 100 }, signal);
    await getConversationMessages('a/b', { before: 51, limit: 50 }, signal);
    await getUnreadConversationCount(signal);
    const paths = fetcher.mock.calls.map(([url]) => new URL(url).pathname + new URL(url).search);
    expect(paths).toEqual([
      '/me/conversations?cursor=a%2B%2F%3D+b&limit=20',
      '/conversations/a%2Fb',
      '/conversations/a%2Fb/messages?after=0&limit=100',
      '/conversations/a%2Fb/messages?before=51&limit=50',
      '/me/conversations/unread-count',
    ]);
    for (const [, options] of fetcher.mock.calls) {
      expect(options.signal).toBe(signal);
      expect(options.credentials).toBe('include');
      expect(options.headers.has('X-CSRF-Protection')).toBe(false);
    }
  });

  it('returns contract responses unchanged without marking history read', async () => {
    const responses = [
      inboxPage([]),
      { conversation: conversationDetail() },
      historyPage([message(1)]),
      { unreadConversationCount: 3 },
    ];
    const fetcher = vi.fn();
    for (const response of responses) fetcher.mockResolvedValueOnce(Response.json(response));
    vi.stubGlobal('fetch', fetcher);
    expect(await getConversationInbox()).toEqual(responses[0]);
    expect(await getConversation('A')).toEqual(responses[1]);
    expect(await getConversationMessages('A')).toEqual(responses[2]);
    expect(await getUnreadConversationCount()).toEqual(responses[3]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  });

  it.each([200, 201])(
    'accepts send status %s with an unchanged operation key and body',
    async (status) => {
      const fetcher = vi.fn().mockResolvedValue(Response.json({ message: message(3) }, { status }));
      vi.stubGlobal('fetch', fetcher);
      expect(await sendConversationMessage('A', 'Hello\nAlex', 'operation-1')).toEqual({
        message: message(3),
      });
      const [, options] = fetcher.mock.calls[0];
      expect(options).toMatchObject({
        method: 'POST',
        body: JSON.stringify({ body: 'Hello\nAlex' }),
      });
      expect(options.headers.get('Idempotency-Key')).toBe('operation-1');
      expect(options.headers.get('X-CSRF-Protection')).toBe('1');
      expect(options.signal).toBeUndefined();
    },
  );

  it('sends the actual visible message ID and returns authoritative read state', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ lastReadSequence: 7, unreadCount: 2 }));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    expect(await readConversation('A', 'message-7', signal)).toEqual({
      lastReadSequence: 7,
      unreadCount: 2,
    });
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      signal,
      body: '{"messageId":"message-7"}',
    });
  });
});
