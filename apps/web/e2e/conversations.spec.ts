import { test, expect, type BrowserContext } from '@playwright/test';

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
