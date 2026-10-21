import { test, expect, type Page } from '@playwright/test';
import { corsHeaders } from './support/cors-headers.ts';

function message(sequence: number, conversationId = 'A', senderUserId = 'other') {
  return {
    id: `${conversationId}-${sequence}`,
    conversationId,
    sequence,
    senderUserId,
    body: `Message ${sequence}: can we arrange collection at the station?`,
    attachments: [],
    createdAt: '2026-09-25T10:00:00.000Z',
  };
}
async function server(page: Page, count = 60, useClock = true) {
  const state = {
    messages: {
      A: Array.from({ length: count }, (_, i) => message(i + 1)),
      B: [] as ReturnType<typeof message>[],
    },
    pointers: { A: 0, B: 0 },
    hidden: false,
    writable: true,
    participantRole: 'claimant',
    sharedListing: false,
    secondaryClaim: 'pending',
    decisionError: false,
    decisions: [] as { decision: string; handoverDetails?: string }[],
    handoverDetails: 'Meet at the library after 17:00.',
    claim: 'pending',
    listing: 'active',
    loseResponse: false,
    loseBeforeCommit: false,
    rateLimit: false,
    readOnlySend: false,
    conflict: false,
    gapBeforeSend: false,
    holdOlder: null as (() => Promise<void>) | null,
    sends: [] as { id: string; key: string; body: string }[],
    reads: [] as string[],
    after: [] as number[],
  };
  const operations = new Map<string, ReturnType<typeof message>>();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const unread = (id: 'A' | 'B') =>
    state.messages[id].filter((m) => m.senderUserId !== 'me' && m.sequence > state.pointers[id])
      .length;
  const summary = (id: 'A' | 'B') => ({
    id,
    claim: {
      id: `claim-${id}`,
      status: id === 'B' && state.sharedListing ? state.secondaryClaim : state.claim,
    },
    listing: {
      id: state.sharedListing ? 'listing-A' : `listing-${id}`,
      title: id === 'A' ? 'AirPods Pro' : 'Blue backpack',
      kind: 'found',
      status: state.listing,
      coverImage: null,
    },
    otherParticipant: { id: 'other', displayName: id === 'A' ? 'Alex' : 'Maya' },
    lastMessage: (() => {
      const last = state.messages[id].at(-1);
      if (!last) return null;
      return {
        id: last.id,
        sequence: last.sequence,
        senderUserId: last.senderUserId,
        body: last.body,
        attachmentCount: last.attachments.length,
        createdAt: last.createdAt,
      };
    })(),
    lastActivityAt: '2026-09-25T10:00:00.000Z',
    unreadCount: unread(id),
    canSendMessages:
      id === 'B' && state.sharedListing ? state.secondaryClaim !== 'rejected' : state.writable,
  });
  const claimRecord = () => ({
    id: 'claim-A',
    conversationId: 'A',
    listingId: 'listing-A',
    status: state.claim,
    verificationDetails: 'Private ownership proof',
    handoverDetails: state.claim === 'approved' ? state.handoverDetails : null,
    createdAt: '2026-09-25T10:00:00.000Z',
    updatedAt: '2026-09-25T10:00:00.000Z',
    reviewedAt: null,
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders(request) });
      return;
    }
    if (!['fetch', 'xhr'].includes(request.resourceType())) return route.continue();
    const url = new URL(request.url());
    let json: unknown;
    let status = 200;
    const headers = corsHeaders(request);
    const match = url.pathname.match(/^\/conversations\/([AB])(?:\/(messages|read))?$/);
    if (url.pathname === '/auth/me')
      json = { user: { id: 'me', email: 'me@example.com', displayName: 'Me', role: 'user' } };
    else if (url.pathname === '/me/conversations/unread-count')
      json = { unreadConversationCount: (unread('A') > 0 ? 1 : 0) + (unread('B') > 0 ? 1 : 0) };
    else if (url.pathname === '/me/conversations')
      json = {
        conversations: state.hidden ? [summary('B')] : [summary('A'), summary('B')],
        pageInfo: { hasNextPage: false, endCursor: null },
      };
    else if (url.pathname === '/me/listings' || url.pathname === '/listings')
      json = { listings: [], pageInfo: { hasNextPage: false, endCursor: null } };
    else if (url.pathname === '/claims/claim-A' && request.method() === 'PATCH') {
      const decision = request.postDataJSON();
      state.decisions.push(decision);
      if (state.decisionError) {
        state.decisionError = false;
        status = 503;
        json = {
          error: { code: 'UNAVAILABLE', message: 'Could not save the decision. Please retry.' },
        };
      } else {
        state.claim = decision.decision;
        state.writable = decision.decision === 'approved';
        if (state.writable) {
          state.listing = 'resolved';
          state.secondaryClaim = 'rejected';
          state.handoverDetails = decision.handoverDetails;
        }
        json = { claim: claimRecord() };
      }
    } else if (url.pathname === '/listings/listing-A') {
      json = {
        listing: {
          ...summary('A').listing,
          version: 1,
          description: 'Found near the ticket office.',
          location: 'Central Station',
          occurredOn: '2026-09-25',
          createdAt: '2026-09-25T10:00:00.000Z',
          updatedAt: '2026-09-25T10:00:00.000Z',
        },
        images: [],
        capabilities: {
          canClaim: false,
          canReviewClaims: false,
          canEdit: false,
          canResolve: false,
          canArchive: false,
          canManageImages: false,
        },
        claim: state.participantRole === 'claimant' ? claimRecord() : null,
      };
    } else if (match) {
      const id = match[1] as 'A' | 'B';
      const action = match[2];
      if (state.hidden && id === 'A') {
        status = 404;
        json = { error: { code: 'CONVERSATION_NOT_FOUND', message: 'Unavailable' } };
      } else if (!action)
        json = {
          conversation: {
            ...summary(id),
            participantRole: state.participantRole,
            listing: {
              ...summary(id).listing,
              location: 'Central Station',
              occurredOn: '2026-09-25',
            },
            claim: {
              ...summary(id).claim,
              verificationDetails: 'Private ownership proof',
              handoverDetails: state.claim === 'approved' ? state.handoverDetails : null,
              createdAt: '2026-09-25T10:00:00.000Z',
              reviewedAt: null,
            },
          },
        };
      else if (action === 'read') {
        const target = state.messages[id].find((m) => m.id === request.postDataJSON().messageId)!;
        state.reads.push(target.id);
        state.pointers[id] = Math.max(state.pointers[id], target.sequence);
        json = { lastReadSequence: state.pointers[id], unreadCount: unread(id) };
      } else if (request.method() === 'POST') {
        const key = request.headers()['idempotency-key']!;
        const body = request.postDataJSON().body;
        state.sends.push({ id, key, body });
        const saved = operations.get(`${id}:${key}`);
        if (saved) {
          // Persisted replay precedes the new-message writable check, as on the server.
          json = { message: saved };
        } else if (state.loseBeforeCommit) {
          state.loseBeforeCommit = false;
          return route.abort('failed');
        } else if (state.rateLimit) {
          state.rateLimit = false;
          status = 429;
          headers['Retry-After'] = '2';
          json = { error: { code: 'RATE_LIMITED', message: 'Slow down' } };
        } else if (!state.writable || state.readOnlySend || state.conflict) {
          if (state.readOnlySend) state.writable = false;
          status = 409;
          json = {
            error: {
              code: state.conflict ? 'IDEMPOTENCY_CONFLICT' : 'CONVERSATION_READ_ONLY',
              message: 'Conflict',
            },
          };
        } else {
          if (state.gapBeforeSend) {
            state.gapBeforeSend = false;
            state.messages[id].push(
              message(state.messages[id].length + 1, id),
              message(state.messages[id].length + 2, id),
            );
          }
          const created = { ...message(state.messages[id].length + 1, id, 'me'), body };
          operations.set(`${id}:${key}`, created);
          state.messages[id].push(created);
          status = 201;
          if (state.loseResponse) {
            state.loseResponse = false;
            return route.abort('failed');
          }
          json = { message: created };
        }
      } else {
        const limit = Number(url.searchParams.get('limit') ?? 50);
        const after = url.searchParams.get('after');
        const before = url.searchParams.get('before');
        if (before !== null && state.holdOlder) await state.holdOlder();
        if (after !== null) state.after.push(Number(after));
        const filtered = state.messages[id].filter(
          (m) =>
            (after === null || m.sequence > Number(after)) &&
            (before === null || m.sequence < Number(before)),
        );
        json = {
          messages: after === null ? filtered.slice(-limit) : filtered.slice(0, limit),
          pageInfo: { hasMore: filtered.length > limit },
        };
      }
    } else {
      status = 404;
      json = { error: { code: 'UNEXPECTED_REQUEST', message: url.pathname } };
    }
    await route.fulfill({ status, json, headers });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (useClock) await page.clock.install();
  return { state, errors };
}

test('a cold unavailable detail immediately reconciles a deferred initial inbox', async ({
  page,
}) => {
  const { state, errors } = await server(page, 0);
  state.hidden = true;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let heads = 0;
  await page.route(/\/me\/conversations(?:\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') return route.fallback();
    heads += 1;
    if (heads !== 1) return route.fallback();
    await held;
    await route.fulfill({
      json: { conversations: [], pageInfo: { hasNextPage: false, endCursor: null } },
      headers: corsHeaders(request),
    });
  });
  try {
    await page.goto('/messages/A');
    await expect(
      page.getByRole('heading', { name: 'This conversation is no longer available.' }),
    ).toBeVisible();
    // No clock advancement or manual refresh. The initial request is still held,
    // so regular interval polling cannot start until it is superseded or completed.
    await expect.poll(() => heads).toBe(2);
    release();
    await page.getByRole('button', { name: 'Back to messages' }).click();
    await expect(page.locator('a[href="/messages/B"]')).toBeVisible();
    await expect(page.locator('a[href="/messages/A"]')).toHaveCount(0);
    await expect(page.getByText('No conversations yet', { exact: true })).toHaveCount(0);
    expect(heads).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});

test('history anchors, incoming announcements and read visibility use the actual scroll viewport', async ({
  page,
}, testInfo) => {
  const { state, errors } = await server(page);
  await page.goto('/messages/A');
  const history = page.getByRole('region', { name: 'Message history' });
  await expect(history.locator('[data-message-id]')).toHaveCount(50);
  await expect.poll(() => state.pointers.A).toBe(60);
  await expect(page.getByTestId('message-announcer')).toBeEmpty();
  await history.evaluate((element) => {
    element.scrollTop = 0;
  });
  const row = history.locator('[data-message-id="A-11"]');
  const oldY = (await row.boundingBox())!.y;
  await history.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(history.locator('[data-message-id]')).toHaveCount(60);
  expect(Math.abs((await row.boundingBox())!.y - oldY)).toBeLessThan(2);
  await expect(page.getByTestId('message-announcer')).toBeEmpty();
  await history.evaluate((element) => {
    element.scrollTop = 500;
  });
  await expect.poll(() => history.evaluate((element) => element.scrollTop)).toBe(500);
  state.messages.A.push(message(61));
  await page.clock.runFor(4_100);
  await expect(page.getByRole('button', { name: 'New messages' })).toBeVisible();
  expect(await history.evaluate((element) => element.scrollTop)).toBe(500);
  expect(state.pointers.A).toBe(60);
  await expect(page.getByTestId('message-announcer')).toContainText('Message 61');
  await page.getByRole('button', { name: 'New messages' }).click();
  await expect.poll(() => state.pointers.A).toBe(61);
  await expect(page.getByRole('button', { name: 'New messages' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('thread.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('a concurrent append and user scroll do not displace the older-history anchor', async ({
  page,
}) => {
  const { state, errors } = await server(page);
  await page.goto('/messages/A');
  const history = page.getByRole('region', { name: 'Message history' });
  await expect(history.locator('[data-message-id]')).toHaveCount(50);
  await expect.poll(() => state.pointers.A).toBe(60);
  let release!: () => void;
  let requested = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.holdOlder = () => {
    requested = true;
    return held;
  };
  await history.evaluate((element) => {
    element.scrollTop = 0;
  });
  await history.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect.poll(() => requested).toBe(true);
  await history.evaluate((element) => {
    element.scrollTop = 240;
  });
  state.messages.A.push(message(61));
  await page.clock.runFor(4_100);
  await expect(page.getByRole('button', { name: 'New messages' })).toBeVisible();
  const saved = await history.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const row = [...element.querySelectorAll<HTMLElement>('[data-message-id]')].find(
      (candidate) => candidate.getBoundingClientRect().bottom > top,
    )!;
    return { id: row.dataset.messageId!, y: row.getBoundingClientRect().top };
  });
  release();
  await expect(history.locator('[data-message-id]')).toHaveCount(61);
  expect(
    Math.abs((await history.locator(`[data-message-id="${saved.id}"]`).boundingBox())!.y - saved.y),
  ).toBeLessThan(2);
  await expect(page.getByRole('button', { name: 'New messages' })).toBeVisible();
  expect(state.pointers.A).toBe(60);
  expect(errors).toEqual([]);
});

test('own POST ahead of catch-up does not skip incoming messages or duplicate the confirmed send', async ({
  page,
}) => {
  const { state, errors } = await server(page, 50);
  await page.goto('/messages/A');
  const input = page.getByRole('textbox', { name: 'Write a message' });
  await expect(page.locator('[data-message-id="A-50"]')).toBeVisible();
  state.gapBeforeSend = true;
  await input.fill('Yes, tomorrow works.');
  await input.press('Control+Enter');
  await expect(page.locator('[data-message-id="A-53"]')).toHaveCount(1);
  await page.clock.runFor(4_100);
  await expect(page.locator('[data-message-id="A-51"]')).toHaveCount(1);
  await expect(page.locator('[data-message-id="A-52"]')).toHaveCount(1);
  await expect(page.locator('[data-message-id="A-53"]')).toHaveCount(1);
  expect(state.after).toContain(50);
  expect(state.sends).toHaveLength(1);
  await expect(page.getByTestId('message-announcer')).toContainText('2 new messages');
  expect(errors).toEqual([]);
});

test('uncertain sends lock new messages across routes and retain the exact retry key/body', async ({
  page,
}) => {
  const { state, errors } = await server(page, 0);
  await page.goto('/messages/A');
  state.loseResponse = true;
  const input = page.getByRole('textbox', { name: 'Write a message' });
  await input.fill('  Please keep it safe.  ');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Delivery status unknown', { exact: true })).toBeVisible();
  await expect(input).not.toBeEditable();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await input.press('B');
  await input.press('Control+Enter');
  await expect(input).toHaveValue('');
  expect(state.sends).toHaveLength(1);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Activity' })
    .click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: /^Messages/ })
    .click();
  await page.locator('a[href="/messages/B"]').click();
  await expect(input).toHaveValue('');
  await expect(input).toBeEditable();
  await expect(page.locator('[data-operation-id]')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: /^Messages/ })
    .click();
  await page.locator('a[href="/messages/A"]').click();
  await expect(input).toHaveValue('');
  await expect(input).not.toBeEditable();
  await page.getByRole('button', { name: 'Retry to confirm' }).click();
  await expect(page.locator('[data-operation-id]')).toHaveCount(0);
  await expect(page.locator('[data-message-id="A-1"]')).toHaveCount(1);
  await expect(input).toBeEditable();
  expect(state.sends).toHaveLength(2);
  expect(state.sends[1]).toEqual(state.sends[0]);
  expect(state.sends[0]!.body).toBe('Please keep it safe.');
  expect(errors).toEqual([]);
});

test('ordinary unsent drafts stay private to A and B across route changes', async ({ page }) => {
  const { state, errors } = await server(page, 0);
  await page.goto('/messages/A');
  const input = page.getByRole('textbox', { name: 'Write a message' });
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  const messages = navigation.getByRole('link', { name: /^Messages/ });
  await input.fill('Draft for Alex');
  await navigation.getByRole('link', { name: 'Activity' }).click();
  await messages.click();
  await page.locator('a[href="/messages/B"]').click();
  await expect(input).toHaveValue('');
  await input.fill('Draft for Maya');
  await messages.click();
  await page.locator('a[href="/messages/A"]').click();
  await expect(input).toHaveValue('Draft for Alex');
  await messages.click();
  await page.locator('a[href="/messages/B"]').click();
  await expect(input).toHaveValue('Draft for Maya');
  expect(state.sends).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('an uncertain persisted send can be confirmed after context becomes read-only', async ({
  page,
}) => {
  const { state, errors } = await server(page, 0);
  await page.goto('/messages/A');
  state.loseResponse = true;
  const input = page.getByRole('textbox', { name: 'Write a message' });
  await input.fill('Original A');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Delivery status unknown', { exact: true })).toBeVisible();
  state.claim = 'rejected';
  state.writable = false;
  await page.clock.runFor(12_100);
  await expect(input).toHaveCount(0);
  await expect(page.getByText(/This conversation is read-only/)).toBeVisible();
  const retry = page.getByRole('button', { name: 'Retry to confirm' });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.locator('[data-operation-id]')).toHaveCount(0);
  await expect(page.locator('[data-message-id="A-1"]')).toHaveCount(1);
  expect(state.sends).toHaveLength(2);
  expect(state.sends[1]).toEqual(state.sends[0]);
  expect(state.messages.A).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('a definitive read-only retry restores the original body to the session draft', async ({
  page,
}) => {
  const { state, errors } = await server(page, 0);
  await page.goto('/messages/A');
  state.loseBeforeCommit = true;
  const input = page.getByRole('textbox', { name: 'Write a message' });
  const body = 'Original A\nKeep the blue case 🔑.';
  await input.fill(`  ${body}  `);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Delivery status unknown', { exact: true })).toBeVisible();
  await expect(input).not.toBeEditable();
  state.readOnlySend = true;
  await page.getByRole('button', { name: 'Retry to confirm' }).click();
  await expect(page.locator('[data-operation-id]')).toHaveCount(0);
  await expect(input).toHaveCount(0);
  await expect(page.getByText(/Your unsent draft has been kept for this session/)).toBeVisible();
  const recovery = page.getByRole('textbox', { name: 'Unsent draft', exact: true });
  await expect(recovery).toBeVisible();
  await expect(recovery).toHaveValue(body);
  await expect(recovery).toBeEnabled();
  await expect(recovery).toHaveAttribute('readonly', '');
  await recovery.focus();
  await recovery.press('Control+a');
  expect(
    await recovery.evaluate((element: HTMLTextAreaElement) =>
      element.value.slice(element.selectionStart, element.selectionEnd),
    ),
  ).toBe(body);
  await recovery.press('B');
  await recovery.press('Control+Enter');
  await expect(recovery).toHaveValue(body);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
  await expect(
    page.getByText('No messages were sent in this conversation.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('No messages yet. Start the conversation about this item.', { exact: true }),
  ).toHaveCount(0);
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await navigation.getByRole('link', { name: 'Activity' }).click();
  await navigation.getByRole('link', { name: /^Messages/ }).click();
  await page.locator('a[href="/messages/A"]').click();
  await expect(page.getByText(/Your unsent draft has been kept for this session/)).toBeVisible();
  await expect(recovery).toHaveValue(body);
  expect(state.sends).toHaveLength(2);
  expect(state.sends[1]).toEqual(state.sends[0]);
  expect(state.sends[0]!.body).toBe(body);
  expect(state.messages.A).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('rate limit retains the operation and retries the same UUID after Retry-After', async ({
  page,
}) => {
  const { state, errors } = await server(page, 0);
  state.rateLimit = true;
  await page.goto('/messages/A');
  const input = page.getByRole('textbox', { name: 'Write a message' });
  await input.fill('Hello');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeDisabled();
  await expect(page.getByText('Temporarily rate-limited.', { exact: true })).toBeVisible();
  await expect(input).not.toBeEditable();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await input.press('Control+Enter');
  expect(state.sends).toHaveLength(1);
  await page.clock.runFor(2_100);
  await expect(retry).toBeEnabled();
  await expect(input).not.toBeEditable();
  await input.press('B');
  await input.press('Control+Enter');
  await expect(input).toHaveValue('');
  expect(state.sends).toHaveLength(1);
  await retry.click();
  await expect(page.locator('[data-operation-id]')).toHaveCount(0);
  await expect(input).toBeEditable();
  expect(state.sends).toHaveLength(2);
  expect(state.sends[1]).toEqual(state.sends[0]);
  expect(errors).toEqual([]);
});

test('composer counts code points, keeps Enter multiline and guards IME submission', async ({
  page,
}) => {
  const { state, errors } = await server(page, 0);
  await page.goto('/messages/A');
  const input = page.getByRole('textbox', { name: 'Write a message' });
  await input.fill('First line');
  await input.press('Enter');
  await input.press('a');
  expect(state.sends).toHaveLength(0);
  await expect(input).toHaveValue('First line\na');
  await input.dispatchEvent('compositionstart');
  await input.press('Control+Enter');
  expect(state.sends).toHaveLength(0);
  await input.dispatchEvent('compositionend');
  await input.fill('😀'.repeat(2001));
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await expect(page.getByText('2000+ / 2000', { exact: true })).toBeVisible();
  // Commit 4 gates the button; keyboard submit must still validate independently.
  await input.press('Control+Enter');
  await expect(page.getByRole('alert')).toContainText('up to 2000 Unicode characters');
  expect(state.sends).toHaveLength(0);
  await input.fill('😀'.repeat(2000));
  await expect(page.getByText('2000 / 2000', { exact: true })).toBeVisible();
  expect(await input.getAttribute('maxlength')).toBeNull();
  await input.press('Control+Enter');
  await expect(page.locator('[data-message-id="A-1"]')).toHaveCount(1);
  expect(Array.from(state.sends[0]!.body)).toHaveLength(2000);
  expect(state.reads).toEqual([]);
  expect(errors).toEqual([]);
});

test('polled claim changes explain context but canSendMessages alone controls the composer', async ({
  page,
}) => {
  const { state, errors } = await server(page, 0);
  await page.goto('/messages/A');
  const input = page.getByRole('textbox', { name: 'Write a message' });
  await expect(input).toBeVisible();
  await input.fill('Keep this private draft');
  state.claim = 'approved';
  state.listing = 'archived';
  await page.clock.runFor(12_100);
  await expect(page.getByText('Meet at the library after 17:00.')).toBeVisible();
  await expect(input).toBeVisible();
  state.claim = 'rejected';
  state.writable = false;
  await page.clock.runFor(12_100);
  await expect(input).toHaveCount(0);
  await expect(page.getByText(/This conversation is read-only/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Unsent draft' })).toHaveValue(
    'Keep this private draft',
  );
  state.hidden = true;
  await page.clock.runFor(12_100);
  await expect(
    page.getByRole('heading', { name: 'This conversation is no longer available.' }),
  ).toBeVisible();
  await expect(page.locator('a[href="/messages/A"]')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Unsent draft' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a read-only send refreshes context and retains the draft; conflicts never auto-retry', async ({
  page,
}) => {
  const { state, errors } = await server(page, 0);
  await page.goto('/messages/A');
  const input = page.getByRole('textbox', { name: 'Write a message' });
  state.conflict = true;
  await input.fill('Original text');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText("Couldn't safely retry this message");
  await page.clock.runFor(4_100);
  expect(state.sends).toHaveLength(1);
  await expect(input).toHaveValue('Original text');
  state.conflict = false;
  state.readOnlySend = true;
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(input).toHaveCount(0);
  await expect(page.getByText(/Your unsent draft has been kept for this session/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('owner approval uses a focused dialog and reconciles sibling claims, handover and inbox', async ({
  page,
}) => {
  // Use native browser frames for the modal's focus restoration; this flow needs no clock jumps.
  const { state, errors } = await server(page, 0, false);
  state.participantRole = 'owner';
  state.sharedListing = true;
  await page.goto('/messages/A');
  const approve = page.getByRole('button', { name: 'Approve claim', exact: true });
  await approve.click();
  const dialog = page.getByRole('dialog', { name: 'Approve this claim?' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(approve).toBeFocused();
  await approve.click();
  await dialog.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(dialog.getByRole('alert')).toContainText('10 and 1000');
  expect(state.decisions).toHaveLength(0);
  await dialog
    .getByLabel('Private collection instructions')
    .fill('Collect at the main library after 17:00.');
  state.decisionError = true;
  await dialog.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Please retry');
  await expect(dialog.getByLabel('Private collection instructions')).toHaveValue(
    'Collect at the main library after 17:00.',
  );
  await dialog.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Collect at the main library after 17:00.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AirPods Pro', exact: true })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Write a message' })).toBeEditable();
  await expect(page.locator('[data-message-id]')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: /^Messages/ })
    .click();
  await expect(page.locator('a[href="/messages/A"]')).toContainText('Claim approved');
  await expect(page.locator('a[href="/messages/B"]')).toContainText('Read-only');
  expect(state.decisions).toEqual([
    { decision: 'approved', handoverDetails: 'Collect at the main library after 17:00.' },
    { decision: 'approved', handoverDetails: 'Collect at the main library after 17:00.' },
  ]);
  expect(errors).toEqual([]);
});

test('reject requires confirmation, restores cancel focus and leaves a read-only thread', async ({
  page,
}) => {
  const { state, errors } = await server(page, 0);
  state.participantRole = 'owner';
  await page.goto('/messages/A');
  const reject = page.getByRole('button', { name: 'Reject', exact: true });
  await reject.click();
  const dialog = page.getByRole('dialog', { name: 'Reject this claim?' });
  await expect(dialog).toContainText('cannot be undone');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(reject).toBeFocused();
  expect(state.decisions).toHaveLength(0);
  await reject.click();
  await dialog.getByRole('button', { name: 'Confirm rejection' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('This conversation is read-only.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Write a message' })).toHaveCount(0);
  await expect(reject).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Unsent draft' })).toHaveCount(0);
  await expect(
    page.getByText('No messages were sent in this conversation.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AirPods Pro', exact: true })).toBeFocused();
  expect(state.decisions).toEqual([{ decision: 'rejected' }]);
  expect(errors).toEqual([]);
});

test('View report returns to the same conversation and keeps its private draft', async ({
  page,
}) => {
  const { errors } = await server(page, 0);
  await page.goto('/messages');
  await page.locator('a[href="/messages/A"]').click();
  await expect(page.getByRole('button', { name: 'Approve claim' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Write a message' }).fill('Private unsent draft');
  await page.getByRole('link', { name: 'View report' }).click();
  await expect(page).toHaveURL(/\/listings\/listing-A$/);
  await expect(page.getByRole('link', { name: 'Open conversation' })).toHaveAttribute(
    'href',
    '/messages/A',
  );
  await page.getByRole('link', { name: 'Back to conversation' }).click();
  await expect(page).toHaveURL(/\/messages\/A$/);
  await expect(page.getByRole('textbox', { name: 'Write a message' })).toHaveValue(
    'Private unsent draft',
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/messages$/);
  expect(errors).toEqual([]);
});
