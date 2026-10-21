import { test, expect, type Page } from '@playwright/test';
import { corsHeaders } from './support/cors-headers.ts';

const titles = ['AirPods Pro', 'Blue backpack', 'Silver ring', 'Canon camera', 'House keys'];
function conversation(index: number) {
  return {
    id: `conversation-${index}`,
    claim: { id: `claim-${index}`, status: index === 2 ? 'rejected' : 'pending' },
    listing: {
      id: `listing-${index}`,
      title: titles[index % titles.length],
      kind: 'found',
      status: 'active',
      coverImage: null,
    },
    otherParticipant: {
      id: `person-${index}`,
      displayName: ['Alex', 'Maya', 'Sam', 'Jamie'][index % 4],
    },
    lastMessage:
      index === 1
        ? null
        : {
            id: `message-${index}`,
            sequence: 1,
            attachmentCount: 0,
            body:
              index === 0
                ? 'Can we meet tomorrow at the station?'
                : 'Thanks for getting in touch about my item.',
            senderUserId: `person-${index}`,
            createdAt: '2026-09-25T10:00:00.000Z',
          },
    lastActivityAt: new Date(Date.UTC(2026, 8, 25, 10, 0, 0) - index * 60_000).toISOString(),
    unreadCount: index === 0 ? 3 : 0,
    canSendMessages: index !== 2,
  };
}

async function mockApi(page: Page, mode: 'normal' | 'empty' | 'error' = 'normal') {
  const requests: string[] = [];
  let fail = mode === 'error';
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders(request) });
      return;
    }
    if (!['fetch', 'xhr'].includes(request.resourceType())) return route.continue();
    const url = new URL(request.url());
    requests.push(url.pathname + url.search);
    let json: unknown;
    let status = 200;
    if (url.pathname === '/auth/me')
      json = { user: { id: 'user', email: 'alex@example.com', displayName: 'Alex', role: 'user' } };
    else if (url.pathname === '/me/conversations/unread-count')
      json = { unreadConversationCount: 1 };
    else if (url.pathname === '/me/conversations') {
      if (fail) {
        fail = false;
        status = 503;
        json = { error: { code: 'HTTP_ERROR', message: 'Offline' } };
      } else if (mode === 'empty')
        json = { conversations: [], pageInfo: { hasNextPage: false, endCursor: null } };
      else if (url.searchParams.has('cursor'))
        json = {
          conversations: [conversation(19), conversation(20)],
          pageInfo: { hasNextPage: false, endCursor: null },
        };
      else
        json = {
          conversations: Array.from({ length: 20 }, (_, index) => conversation(index)),
          pageInfo: { hasNextPage: true, endCursor: 'next-page' },
        };
    } else if (/^\/conversations\/[^/]+\/messages$/.test(url.pathname)) {
      json = { messages: [], pageInfo: { hasMore: false } };
    } else if (/^\/conversations\/[^/]+$/.test(url.pathname)) {
      const id = url.pathname.split('/')[2]!;
      const parsed = Number(id.replace('conversation-', ''));
      const summary = conversation(Number.isFinite(parsed) ? parsed : 0);
      json = {
        conversation: {
          ...summary,
          id,
          participantRole: 'claimant',
          listing: { ...summary.listing, location: 'Central Station', occurredOn: '2026-09-25' },
          claim: {
            ...summary.claim,
            verificationDetails: 'Private ownership proof',
            handoverDetails: null,
            createdAt: summary.lastActivityAt,
            reviewedAt: null,
          },
        },
      };
    } else if (url.pathname === '/listings' || url.pathname === '/me/listings')
      json = { listings: [], pageInfo: { hasNextPage: false, endCursor: null } };
    else {
      status = 404;
      json = { error: { code: 'UNEXPECTED_REQUEST', message: url.pathname } };
    }
    await route.fulfill({
      status,
      json,
      headers: corsHeaders(request),
    });
  });
  return { requests, errors };
}

test('route-driven workspace preserves inbox pagination and scroll on desktop and mobile', async ({
  page,
  isMobile,
}, testInfo) => {
  const { requests, errors } = await mockApi(page);
  await page.goto('/activity');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: /^Messages/ })
    .click();
  const inbox = page.getByRole('region', { name: 'Messages', exact: true });
  await expect(inbox.getByRole('link')).toHaveCount(20);
  await expect(
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Messages, 1 unread conversation' }),
  ).toBeVisible();
  const detail = page.getByRole('region', { name: 'Conversation', exact: true });
  if (isMobile) await expect(detail).toBeHidden();
  else await expect(page.getByRole('heading', { name: 'Select a conversation' })).toBeVisible();
  const beforeSelection = requests.filter((request) =>
    request.startsWith('/me/conversations?'),
  ).length;
  await inbox.getByRole('button', { name: 'Load more' }).click();
  await expect(inbox.getByRole('link')).toHaveCount(21);
  await expect(inbox.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  const scroll = page.getByTestId('inbox-scroll');
  await scroll.evaluate((element) => {
    element.scrollTop = 600;
  });
  const row = inbox.locator('a[href="/messages/conversation-5"]');
  await row.scrollIntoViewIfNeeded();
  const scrollTop = await scroll.evaluate((element) => element.scrollTop);
  await row.click();
  await expect(page).toHaveURL(/\/messages\/conversation-5$/);
  await expect(detail.getByRole('heading', { name: 'Maya', exact: true })).toBeVisible();
  if (isMobile) {
    await expect(inbox).toBeHidden();
    await expect(detail.getByRole('heading', { name: 'Maya', exact: true })).toBeFocused();
    await detail.getByRole('link', { name: 'Messages', exact: true }).click();
  } else {
    await expect(inbox).toBeVisible();
    await expect(row).toHaveAttribute('aria-current', 'page');
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: /^Messages/ })
      .click();
  }
  await expect(page).toHaveURL(/\/messages$/);
  await expect(inbox).toBeVisible();
  if (isMobile) await expect(row).toBeFocused();
  expect(await scroll.evaluate((element) => element.scrollTop)).toBeCloseTo(scrollTop, 0);
  expect(requests.filter((request) => request.startsWith('/me/conversations?')).length).toBe(
    beforeSelection + 1,
  );
  expect(requests.some((request) => request.startsWith('/conversations/'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1),
  ).toBe(true);
  await scroll.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: testInfo.outputPath('workspace.png'), fullPage: true });
  if (isMobile) {
    await page.goBack();
    await expect(page).toHaveURL(/\/activity$/);
    // Forward still reaches the original inbox entry rather than another copy of it.
    await page.goForward();
    await expect(page).toHaveURL(/\/messages$/);
  }
  expect(errors).toEqual([]);
});

test('cold detail URLs, back navigation and narrow viewports work with a thread', async ({
  page,
  isMobile,
}) => {
  const { requests, errors } = await mockApi(page);
  await page.goto('/activity');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  // Wait for Activity's data before replacing the document with a cold detail URL.
  await expect(page.getByText('No reports on this page.', { exact: true })).toBeVisible();
  await page.goto('/messages/conversation-0');
  const detail = page.getByRole('region', { name: 'Conversation', exact: true });
  await expect(detail.getByRole('heading', { name: 'Alex', exact: true })).toBeVisible();
  await expect(detail.getByRole('link', { name: 'View report' })).toHaveAttribute(
    'href',
    '/listings/listing-0',
  );
  if (isMobile) {
    await page.setViewportSize({ width: 320, height: 640 });
    await expect(detail.getByRole('link', { name: 'Messages', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await detail.getByRole('link', { name: 'Messages', exact: true }).click();
    const inbox = page.getByRole('region', { name: 'Messages', exact: true });
    await expect(inbox).toBeVisible();
    await expect(inbox.locator('a[href="/messages/conversation-0"]')).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(/\/activity$/);
    await expect(page.getByText('No reports on this page.', { exact: true })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/messages$/);
    await expect(inbox.getByRole('link')).toHaveCount(20);
  }
  expect(requests.some((request) => request.startsWith('/conversations/'))).toBe(true);
  expect(errors).toEqual([]);
});

test('a cold detail absent from loaded rows returns focus to the inbox heading', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'The return control is presented on mobile.');
  const { errors } = await mockApi(page);
  await page.goto('/activity');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.getByText('No reports on this page.', { exact: true })).toBeVisible();
  const unreadNavigation = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Messages, 1 unread conversation', exact: true });
  await expect(unreadNavigation).toBeVisible();
  await page.goto('/messages/not-loaded');
  const detail = page.getByRole('region', { name: 'Conversation', exact: true });
  await expect(detail.getByRole('textbox', { name: 'Write a message' })).toBeVisible();
  await detail.getByRole('link', { name: 'Messages', exact: true }).click();
  await expect(page).toHaveURL(/\/messages$/);
  await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByText('No reports on this page.', { exact: true })).toBeVisible();
  await expect(unreadNavigation).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/messages$/);
  await expect(
    page.getByRole('region', { name: 'Messages', exact: true }).getByRole('link'),
  ).toHaveCount(20);
  expect(errors).toEqual([]);
});

test('inbox errors can be retried and empty state is reachable', async ({ page }) => {
  const { errors } = await mockApi(page, 'error');
  await page.goto('/messages');
  await expect(page.getByRole('alert')).toContainText('Could not load your conversations.');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('region', { name: 'Messages', exact: true }).getByRole('link'),
  ).toHaveCount(20);
  await page.unrouteAll();
  await mockApi(page, 'empty');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No conversations yet' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the same Messages navigation and badge are available on home, browse and activity', async ({
  page,
}) => {
  const { errors } = await mockApi(page);
  for (const path of ['/', '/listings', '/activity']) {
    await page.goto(path);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toHaveCount(1);
    await expect(nav.getByRole('link', { name: 'Messages, 1 unread conversation' })).toBeVisible();
    await nav.getByRole('link', { name: /^Messages/ }).click();
    await expect(page).toHaveURL(/\/messages$/);
    await expect(
      page.getByRole('region', { name: 'Messages', exact: true }).getByRole('link'),
    ).toHaveCount(20);
  }
  expect(errors).toEqual([]);
});
