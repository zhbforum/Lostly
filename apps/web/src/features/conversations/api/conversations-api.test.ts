import { afterEach, describe, expect, it, vi } from 'vitest';
import { conversationDetail, historyPage, inboxPage, message } from '@/test/fixtures/conversations';
import {
  getConversation,
  getConversationInbox,
  getConversationMessages,
  getUnreadConversationCount,
  readConversation,
  refreshMessageAttachments,
  sendConversationMessage,
} from './conversations-api';

afterEach(() => vi.unstubAllGlobals());

describe('conversation API', () => {
  it('refreshes the encoded conversation/message pair without a body, with session credentials and CSRF', async () => {
    const response = { attachments: [] };
    const fetcher = vi.fn().mockResolvedValue(Response.json(response));
    vi.stubGlobal('fetch', fetcher);

    expect(await refreshMessageAttachments('a/b', 'message/1')).toEqual(response);

    const [url, options] = fetcher.mock.calls[0];

    expect(new URL(url).pathname).toBe(
      '/conversations/a%2Fb/messages/message%2F1/attachments/refresh',
    );
    expect(options.method).toBe('POST');
    expect(options.body).toBeUndefined();
    expect(options.credentials).toBe('include');
    expect(options.headers.get('X-CSRF-Protection')).toBe('1');
    expect(options.headers.has('Content-Type')).toBe(false);
    expect(options.headers.has('Idempotency-Key')).toBe(false);
  });

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

      expect(
        await sendConversationMessage('A', { body: 'Hello\nAlex', images: [] }, 'operation-1'),
      ).toEqual({
        message: message(3),
      });

      const [, options] = fetcher.mock.calls[0];

      expect(options).toMatchObject({
        method: 'POST',
        body: JSON.stringify({ body: 'Hello\nAlex' }),
      });
      expect(options.headers.get('Idempotency-Key')).toBe('operation-1');
      expect(options.headers.get('Content-Type')).toBe('application/json');
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

it.each([null, 'Caption\ntext'])(
  'builds a fresh ordered multipart payload with body %j',
  async (body) => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ message: message(1) }));
    vi.stubGlobal('fetch', fetcher);
    const a = new File(['A'], 'private-a.jpg', { type: 'image/jpeg' });
    const b = new File(['B'], 'private-b.webp', { type: 'image/webp' });
    const images = [a, b, a];

    for (let attempt = 0; attempt < 2; attempt++) {
      await sendConversationMessage('A', { body, images }, 'same-operation');

      const [, options] = fetcher.mock.calls[attempt];

      expect(options.body).toBeInstanceOf(FormData);
      expect(options.body.getAll('body')).toEqual(body === null ? [] : [body]);

      const files = options.body.getAll('images');

      expect(files).toHaveLength(3);

      images.forEach((file, index) => expect(files[index]).toBe(file));

      expect(options.headers.has('Content-Type')).toBe(false);
      expect(options.headers.get('Idempotency-Key')).toBe('same-operation');
      expect(options.headers.get('X-CSRF-Protection')).toBe('1');
      expect(options.credentials).toBe('include');
      expect(options.signal).toBeUndefined();
    }

    expect(fetcher.mock.calls[0][1].body).not.toBe(fetcher.mock.calls[1][1].body);
  },
);
