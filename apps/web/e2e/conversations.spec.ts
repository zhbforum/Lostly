import { test, expect, type BrowserContext } from '@playwright/test';
import { barrier } from './support/barrier.ts';
import { chooseImages, expectDecoded, multipartPayload } from './support/conversation-images.ts';

const api = 'http://localhost:3000';
const headers = { 'X-CSRF-Protection': '1' };
async function register(context: BrowserContext, displayName: string) {
  const response = await context.request.post(`${api}/auth/register`, {
    headers,
    data: {
      displayName,
      email: `chat-${crypto.randomUUID()}@example.com`,
      password: 'a long chat e2e-only password',
    },
  });
  expect(response.status()).toBe(201);
}

test('claim, conversation, unread/read, reply and approval connect both participants', async ({
  page: owner,
  context,
  browser,
}, testInfo) => {
  const claimantContext = await browser.newContext({
    baseURL: 'http://localhost:4173',
    viewport: testInfo.project.use.viewport,
    screen: testInfo.project.use.contextOptions?.screen,
    deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
    userAgent: testInfo.project.use.userAgent,
  });
  try {
    await register(context, 'Finder');
    await register(claimantContext, 'Alex');
    const report = await context.request.post(`${api}/listings`, {
      headers,
      data: {
        kind: 'found',
        title: 'Conversation E2E AirPods',
        description: 'Found AirPods near the main library entrance.',
        location: 'Central library',
        occurredOn: '2026-09-01',
      },
    });
    expect(report.status()).toBe(201);
    const { listing } = await report.json();
    const claimant = await claimantContext.newPage();
    const errors: string[] = [];
    owner.on('pageerror', (error) => errors.push(error.message));
    claimant.on('pageerror', (error) => errors.push(error.message));
    await claimant.goto(`/listings/${listing.id}`);
    await claimant
      .getByLabel(/Proof of ownership/)
      .fill('The case has my initials AX engraved underneath.');
    const submitted = claimant.waitForResponse(
      (response) =>
        response.url().endsWith(`/listings/${listing.id}/claims`) &&
        response.request().method() === 'POST',
    );
    await claimant.getByRole('button', { name: 'Submit private claim' }).click();
    const created = await submitted;
    expect(created.status()).toBe(201);
    const { claim } = await created.json();
    await expect(claimant).toHaveURL(new RegExp(`/listings/${listing.id}$`));
    await expect(claimant.getByText('Your claim is awaiting review')).toBeVisible();
    await claimant.getByRole('link', { name: 'Open conversation' }).click();
    await expect(claimant).toHaveURL(new RegExp(`/messages/${claim.conversationId}$`));
    await claimant
      .getByRole('textbox', { name: 'Write a message' })
      .fill('Hello, could I collect them tomorrow?');
    await claimant.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(claimant.locator('[data-message-id]')).toContainText([
      'Hello, could I collect them tomorrow?',
    ]);

    await owner.goto('/activity?tab=incoming');
    // Check emulation on app pages: about:blank has no mobile viewport meta tag.
    for (const participant of [owner, claimant]) {
      expect(participant.viewportSize()).toEqual(testInfo.project.use.viewport);
      expect(
        await participant.evaluate(() => ({
          screen: { width: window.screen.width, height: window.screen.height },
          deviceScaleFactor: window.devicePixelRatio,
          userAgent: navigator.userAgent,
        })),
      ).toEqual({
        screen: testInfo.project.use.contextOptions?.screen,
        deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
        userAgent: testInfo.project.use.userAgent,
      });
    }
    const ownerNav = owner.getByRole('navigation', { name: 'Main navigation' });
    await expect(
      ownerNav.getByRole('link', { name: 'Messages, 1 unread conversation', exact: true }),
    ).toBeVisible();
    await owner.getByRole('link', { name: 'Open conversation' }).click();
    await expect(owner.locator('[data-message-id]')).toContainText([
      'Hello, could I collect them tomorrow?',
    ]);
    await expect(ownerNav.getByRole('link', { name: 'Messages', exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        const response = await context.request.get(`${api}/me/conversations/unread-count`);
        return (await response.json()).unreadConversationCount;
      })
      .toBe(0);
    await owner
      .getByRole('textbox', { name: 'Write a message' })
      .fill('Yes, I can meet you at reception.');
    await owner.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(claimant.locator('[data-message-id]')).toContainText(
      ['Hello, could I collect them tomorrow?', 'Yes, I can meet you at reception.'],
      { timeout: 10_000 },
    );
    await owner.getByRole('link', { name: 'View report' }).click();
    await expect(owner.getByRole('link', { name: 'Open conversation' })).toHaveAttribute(
      'href',
      `/messages/${claim.conversationId}`,
    );
    await owner.getByRole('link', { name: 'Edit report', exact: true }).click();
    await owner.getByLabel('Title', { exact: true }).fill('Conversation E2E engraved AirPods');
    await owner.getByRole('button', { name: 'Save changes', exact: true }).click();
    await owner.getByRole('link', { name: 'Back to conversation' }).click();
    await expect(owner).toHaveURL(new RegExp(`/messages/${claim.conversationId}$`));
    await owner.getByRole('button', { name: 'Approve claim' }).click();
    const dialog = owner.getByRole('dialog', { name: 'Approve this claim?' });
    await dialog
      .getByLabel('Private collection instructions')
      .fill('Meet at the main library reception after 17:00.');
    await dialog.getByRole('button', { name: 'Confirm approval' }).click();
    await expect(
      owner.getByText('Meet at the main library reception after 17:00.', { exact: true }),
    ).toBeVisible();
    await expect(
      claimant.getByText('Meet at the main library reception after 17:00.', { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(claimant.getByRole('textbox', { name: 'Write a message' })).toBeEditable();
    await claimant.getByRole('link', { name: 'View report' }).click();
    await expect(claimant.getByText('Your claim was approved')).toBeVisible();
    await claimant.getByRole('link', { name: 'Back to conversation' }).click();
    await expect(claimant).toHaveURL(new RegExp(`/messages/${claim.conversationId}$`));
    expect(errors).toEqual([]);
  } finally {
    await claimantContext.close();
  }
});

test('image messages persist, update inbox/read state and reach the other participant by polling', async ({
  page: owner,
  context,
  browser,
}, testInfo) => {
  const claimantContext = await browser.newContext({
    baseURL: 'http://localhost:4173',
    viewport: testInfo.project.use.viewport,
    screen: testInfo.project.use.contextOptions?.screen,
    deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
    userAgent: testInfo.project.use.userAgent,
  });
  const upload = barrier();
  const errors: string[] = [];
  owner.on('pageerror', (error) => errors.push(error.message));
  try {
    await register(context, 'Image finder');
    await register(claimantContext, 'Image claimant');
    const report = await context.request.post(`${api}/listings`, {
      headers,
      data: {
        kind: 'found',
        title: 'Image conversation E2E case',
        description: 'Found a blue case at the library entrance.',
        location: 'Central library',
        occurredOn: '2026-09-01',
      },
    });
    expect(report.status()).toBe(201);
    const { listing } = await report.json();
    const claimed = await claimantContext.request.post(`${api}/listings/${listing.id}/claims`, {
      headers,
      data: { verificationDetails: 'My initials are engraved inside the blue case.' },
    });
    expect(claimed.status()).toBe(201);
    const { claim } = await claimed.json();
    const conversationId: string = claim.conversationId;
    const path = `/conversations/${conversationId}/messages`;
    const claimant = await claimantContext.newPage();
    claimant.on('pageerror', (error) => errors.push(error.message));
    const sends: Awaited<ReturnType<typeof multipartPayload>>[] = [];
    await claimant.route(`**${path}`, async (route) => {
      if (route.request().method() === 'POST') {
        sends.push(await multipartPayload(route.request()));
        await upload.promise;
      }
      await route.continue();
    });
    const inboxCapabilities: string[] = [];
    const observeInbox = (request: import('@playwright/test').Request) => {
      if (
        request.url().includes('/__test/images/conversations/') ||
        request.url().includes('/attachments/refresh')
      )
        inboxCapabilities.push(request.url());
    };
    owner.on('request', observeInbox);
    await owner.clock.install();
    await owner.goto('/messages');
    await claimant.goto(`/messages/${conversationId}`);
    await chooseImages(claimant, 1);
    await expectDecoded(claimant.getByRole('list', { name: 'Selected images' }).locator('img'), 1);
    await expect(claimant.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    const firstResponse = claimant.waitForResponse(
      (response) => response.url().endsWith(path) && response.request().method() === 'POST',
    );
    await claimant.getByRole('button', { name: 'Send', exact: true }).click();
    try {
      const pending = claimant.locator('[data-operation-id]');
      await expect(pending).toContainText('Photo');
      await expect(pending).toContainText('Sending…');
      await expect.poll(() => sends.length).toBe(1);
      expect(sends[0]!.body).toBeNull();
      expect(sends[0]!.images).toHaveLength(1);
      await expect(claimant.locator('img[src^="blob:"]')).toHaveCount(0);
    } finally {
      upload.release();
    }
    const first = await firstResponse;
    expect(first.status()).toBe(201);
    const { message: imageOnly } = await first.json();
    expect(imageOnly.body).toBeNull();
    expect(imageOnly.attachments).toHaveLength(1);
    expect(imageOnly.sequence).toBe(1);
    const firstRow = claimant.locator(`[data-message-id="${imageOnly.id}"]`);
    await expectDecoded(firstRow.locator('img'), 1);
    await expect(firstRow.locator('img')).toHaveAttribute(
      'src',
      /\/__test\/images\/conversations\//,
    );
    await expect(claimant.locator('[data-operation-id]')).toHaveCount(0);

    // Exercise real polling callbacks without waiting for their wall-clock intervals.
    await owner.clock.runFor(30_100);

    const inboxRow = owner.locator(`[data-conversation-id="${conversationId}"]`);
    await expect(inboxRow.getByText('Photo', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(inboxRow).toContainText('1 unread message');
    const navigation = owner.getByRole('navigation', { name: 'Main navigation' });
    await expect(
      navigation.getByRole('link', { name: 'Messages, 1 unread conversation', exact: true }),
    ).toBeVisible();
    expect(inboxCapabilities).toEqual([]);
    await expect(inboxRow.locator('img')).toHaveCount(0);
    owner.off('request', observeInbox);

    const initial = owner.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === path &&
        response.request().method() === 'GET' &&
        !url.searchParams.has('after')
      );
    });
    const readFirst = owner.waitForResponse(
      (response) =>
        response.url().endsWith(`/conversations/${conversationId}/read`) &&
        response.request().method() === 'POST',
    );
    await inboxRow.click();
    expect((await (await initial).json()).messages.map((m: { id: string }) => m.id)).toEqual([
      imageOnly.id,
    ]);
    await expectDecoded(owner.locator(`[data-message-id="${imageOnly.id}"] img`), 1);
    expect(await (await readFirst).json()).toMatchObject({ lastReadSequence: 1, unreadCount: 0 });
    await expect(navigation.getByRole('link', { name: 'Messages', exact: true })).toBeVisible();

    // Owner is already in the thread: only normal polling may deliver the next row.
    const received = owner.waitForResponse(async (response) => {
      const url = new URL(response.url());
      if (
        url.pathname !== path ||
        url.searchParams.get('after') !== '1' ||
        response.request().method() !== 'GET'
      )
        return false;
      return (await response.json()).messages.some((m: { sequence: number }) => m.sequence === 2);
    });
    const readSecond = owner.waitForResponse(
      (response) =>
        response.url().endsWith(`/conversations/${conversationId}/read`) &&
        response.request().method() === 'POST',
    );
    await claimant
      .getByRole('textbox', { name: 'Write a message' })
      .fill('Here are both identifying marks.');
    await chooseImages(claimant, 2);
    await expectDecoded(claimant.getByRole('list', { name: 'Selected images' }).locator('img'), 2);
    const secondResponse = claimant.waitForResponse(
      (response) => response.url().endsWith(path) && response.request().method() === 'POST',
    );
    await claimant.getByRole('button', { name: 'Send', exact: true }).click();
    const second = await secondResponse;
    expect(second.status()).toBe(201);
    const { message: captioned } = await second.json();
    expect(captioned.sequence).toBe(imageOnly.sequence + 1);
    expect(captioned.attachments.map((a: { position: number }) => a.position)).toEqual([0, 1]);
    expect(sends[1]!.body).toBe('Here are both identifying marks.');
    expect(sends[1]!.images).toHaveLength(2);
    expect(sends[1]!.key).not.toBe(sends[0]!.key);
    await owner.clock.runFor(4_100);
    const polled = await (await received).json();
    expect(polled.messages.map((m: { id: string }) => m.id)).toEqual([captioned.id]);
    const captionRow = owner.locator(`[data-message-id="${captioned.id}"]`);
    await expect(captionRow).toContainText('Here are both identifying marks.');
    await expectDecoded(captionRow.locator('img'), 2);
    await expect(owner.locator('[data-message-id]')).toHaveCount(2);
    expect(await (await readSecond).json()).toMatchObject({ lastReadSequence: 2, unreadCount: 0 });
    await expect(owner).toHaveURL(new RegExp(`/messages/${conversationId}$`));

    // End local ownership; returning and reloading must use history-backed remote capabilities.
    const claimantNavigation = claimant.getByRole('navigation', { name: 'Main navigation' });
    await claimantNavigation.getByRole('link', { name: /^Messages/ }).click();
    await claimant.locator(`[data-conversation-id="${conversationId}"]`).click();
    await expectDecoded(claimant.locator('[data-message-id] img'), 3);
    await claimant.reload();
    await expectDecoded(claimant.locator('[data-message-id] img'), 3);
    await expect(claimant.locator('[data-message-id]')).toHaveCount(2);
    await expect(claimant.locator('[data-operation-id], img[src^="blob:"]')).toHaveCount(0);
    expect(sends).toHaveLength(2);
    const persisted = await claimantContext.request.get(`${api}${path}`);
    expect((await persisted.json()).messages.map((m: { id: string }) => m.id)).toEqual([
      imageOnly.id,
      captioned.id,
    ]);
    expect(errors).toEqual([]);
  } finally {
    upload.release();
    await claimantContext.close();
  }
});
