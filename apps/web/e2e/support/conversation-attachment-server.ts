import type { Page, Route } from '@playwright/test';
import { corsHeaders } from './cors-headers.ts';
import { multipartPayload, pngImage } from './conversation-images.ts';

export const browserTime = Date.parse('2026-10-06T12:00:00.000Z');
export const imageOrigin = 'https://conversation-images.test';

export function attachmentSet(
  messageId: string,
  count = 2,
  generation = 'old',
  expiry = browserTime + 900_000,
) {
  return Array.from({ length: count }, (_, position) => ({
    id: `${messageId}-image-${position}`,
    kind: 'image' as const,
    position,
    url: `${imageOrigin}/${messageId}/${generation}/${position}.png`,
    urlExpiresAt: new Date(expiry).toISOString(),
    width: 32,
    height: 24,
  }));
}

export function historyMessage(
  sequence: number,
  attachments: ReturnType<typeof attachmentSet> = [],
) {
  return {
    id: `A-${sequence}`,
    conversationId: 'A',
    sequence,
    senderUserId: 'other',
    body: attachments.length ? null : `Message ${sequence}: collection at the library.`,
    attachments,
    createdAt: new Date(browserTime).toISOString(),
  };
}

type Reply = { status?: number; json: unknown; headers?: Record<string, string> };
type ImageReply = { status?: number; bytes?: Buffer; gate?: Promise<void> };

export async function attachmentServer(
  page: Page,
  messages: ReturnType<typeof historyMessage>[] = [],
) {
  const state = {
    messages,
    hidden: false,
    writable: true,
    pointer: 0,
    sends: [] as Awaited<ReturnType<typeof multipartPayload>>[],
    refreshes: [] as {
      conversationId: string;
      messageId: string;
      method: string;
      body: string | null;
    }[],
    after: [] as number[],
    imageRequests: [] as string[],
    imageResponses: [] as string[],
    errors: [] as string[],
    unexpected: [] as string[],
    images: new Map<string, ImageReply>(),
    send: null as null | ((attempt: number) => Promise<Reply> | Reply),
    refresh: null as null | ((messageId: string, attempt: number) => Promise<Reply> | Reply),
    history: null as
      | null
      | ((
          after: number | null,
          response: {
            messages: ReturnType<typeof historyMessage>[];
            pageInfo: { hasMore: boolean };
          },
        ) => Promise<void>),
  };
  const context = page.context();
  const listen = (opened: Page) =>
    opened.on('pageerror', (error) => state.errors.push(error.message));
  context.pages().forEach(listen);
  context.on('page', listen);
  const unread = () =>
    state.messages.filter((m) => m.senderUserId !== 'me' && m.sequence > state.pointer).length;
  const summary = () => {
    const last = state.messages.at(-1);
    return {
      id: 'A',
      claim: { id: 'claim-A', status: state.writable ? 'pending' : 'rejected' },
      listing: {
        id: 'listing-A',
        title: 'Image conversation',
        kind: 'found',
        status: 'active',
        coverImage: null,
      },
      otherParticipant: { id: 'other', displayName: 'Alex' },
      lastMessage: last
        ? {
            id: last.id,
            sequence: last.sequence,
            senderUserId: last.senderUserId,
            body: last.body,
            attachmentCount: last.attachments.length,
            createdAt: last.createdAt,
          }
        : null,
      lastActivityAt: new Date(browserTime).toISOString(),
      unreadCount: unread(),
      canSendMessages: state.writable,
    };
  };
  const fulfill = (route: Route, reply: Reply) =>
    route.fulfill({
      status: reply.status ?? 200,
      json: reply.json,
      headers: { ...corsHeaders(route.request()), ...reply.headers },
    });
  // Context-level image routes also serve target=_blank navigations deterministically.
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === imageOrigin) {
      state.imageRequests.push(url.href);
      const image = state.images.get(url.href) ?? {};
      if (image.gate) await image.gate;
      const failed = (image.status ?? 200) >= 400;
      await route.fulfill({
        status: image.status ?? 200,
        contentType: failed ? 'text/plain' : 'image/png',
        body: image.bytes ?? (failed ? Buffer.from('Image unavailable') : pngImage()),
      });
      state.imageResponses.push(url.href);
      return;
    }
    if (url.origin !== 'http://localhost:3000') return route.continue();
    if (request.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    const path = url.pathname;
    if (path === '/auth/me')
      return fulfill(route, {
        json: { user: { id: 'me', email: 'me@example.com', displayName: 'Me', role: 'user' } },
      });
    if (path === '/me/conversations/unread-count')
      return fulfill(route, {
        json: { unreadConversationCount: !state.hidden && unread() > 0 ? 1 : 0 },
      });
    if (path === '/me/conversations')
      return fulfill(route, {
        json: {
          conversations: state.hidden ? [] : [summary()],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      });
    if (state.hidden && path.startsWith('/conversations/A'))
      return fulfill(route, {
        status: 404,
        json: { error: { code: 'CONVERSATION_NOT_FOUND', message: 'Unavailable' } },
      });
    if (path === '/conversations/A')
      return fulfill(route, {
        json: {
          conversation: {
            ...summary(),
            participantRole: 'claimant',
            listing: { ...summary().listing, location: 'Library', occurredOn: '2026-10-01' },
            claim: {
              ...summary().claim,
              verificationDetails: 'Private proof',
              handoverDetails: null,
              createdAt: new Date(browserTime).toISOString(),
              reviewedAt: null,
            },
          },
        },
      });
    if (path === '/conversations/A/read') {
      const target = state.messages.find((m) => m.id === request.postDataJSON().messageId)!;
      state.pointer = Math.max(state.pointer, target.sequence);
      return fulfill(route, { json: { lastReadSequence: state.pointer, unreadCount: unread() } });
    }
    const refresh = path.match(
      /^\/conversations\/([^/]+)\/messages\/([^/]+)\/attachments\/refresh$/,
    );
    if (refresh) {
      state.refreshes.push({
        conversationId: refresh[1]!,
        messageId: refresh[2]!,
        method: request.method(),
        body: request.postData(),
      });
      const reply = state.refresh
        ? await state.refresh(refresh[2]!, state.refreshes.length)
        : {
            json: { attachments: attachmentSet(refresh[2]!, 2, 'fresh', browserTime + 1_800_000) },
          };
      return fulfill(route, reply);
    }
    if (path === '/conversations/A/messages' && request.method() === 'POST') {
      state.sends.push(await multipartPayload(request));
      if (state.send) return fulfill(route, await state.send(state.sends.length));
      const payload = state.sends.at(-1)!;
      const sequence = (state.messages.at(-1)?.sequence ?? 0) + 1;
      const created = {
        ...historyMessage(sequence, attachmentSet(`A-${sequence}`, payload.images.length)),
        senderUserId: 'me',
        body: payload.body as string | null,
      };
      state.messages.push(created);
      return fulfill(route, { status: 201, json: { message: created } });
    }
    if (path === '/conversations/A/messages') {
      const after = url.searchParams.has('after') ? Number(url.searchParams.get('after')) : null;
      const before = url.searchParams.has('before') ? Number(url.searchParams.get('before')) : null;
      const limit = Number(url.searchParams.get('limit') ?? 50);
      if (after !== null) state.after.push(after);
      const filtered = state.messages.filter(
        (m) => (after === null || m.sequence > after) && (before === null || m.sequence < before),
      );
      // Snapshot before a barrier: a held response must really contain the old capabilities.
      const response = structuredClone({
        messages: after === null ? filtered.slice(-limit) : filtered.slice(0, limit),
        pageInfo: { hasMore: filtered.length > limit },
      });
      if (state.history) await state.history(after, response);
      return fulfill(route, { json: response });
    }
    state.unexpected.push(`${request.method()} ${path}`);
    return fulfill(route, {
      status: 404,
      json: { error: { code: 'UNEXPECTED_TEST_REQUEST', message: 'Missing test route' } },
    });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: browserTime });
  return state;
}
