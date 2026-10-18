import { test, expect, type Page } from '@playwright/test';
import { corsHeaders } from './support/cors-headers.ts';

const account = {
  id: 'user',
  email: 'alex.morgan@example.com',
  displayName: 'Alex Morgan',
  role: 'user',
};

async function mockAccount(page: Page, user = account) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const headers = corsHeaders(request);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (!['fetch', 'xhr'].includes(request.resourceType())) return route.continue();

    const path = new URL(request.url()).pathname;
    if (path === '/auth/me') return route.fulfill({ json: { user }, headers });

    if (path === '/auth/providers')
      return route.fulfill({
        json: {
          google: {
            enabled: false,
            linked: false,
          },
        },
        headers,
      });

    if (path === '/me/conversations/unread-count')
      return route.fulfill({ json: { unreadConversationCount: 2 }, headers });
    if (path === '/listings' || path === '/me/listings')
      return route.fulfill({
        json: { listings: [], pageInfo: { hasNextPage: false, endCursor: null } },
        headers,
      });
    if (path === '/me/conversations')
      return route.fulfill({
        json: { conversations: [], pageInfo: { hasNextPage: false, endCursor: null } },
        headers,
      });
    errors.push(`Unexpected request: ${request.method()} ${path}`);
    return route.fulfill({ status: 404, headers });
  });
  return errors;
}

test('account opens with the keyboard, dismisses accessibly and is available across the main pages', async ({
  page,
}, testInfo) => {
  const errors = await mockAccount(page);
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Account: Alex Morgan' });
  const dialog = page.getByRole('dialog', { name: 'Your account' });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Signed in', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('header.png'), fullPage: true });

  for (let index = 0; index < 5; index += 1) await page.keyboard.press('Tab');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(account.email, { exact: true })).toBeVisible();
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('account-open.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.mouse.click(12, 200);
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  for (const label of ['Browse', 'Activity', 'Messages']) {
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: new RegExp(`^${label}`) })
      .click();
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(dialog.getByText(account.email, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('long account details fit narrow screens without shrinking navigation touch targets', async ({
  page,
}) => {
  const user = {
    ...account,
    displayName: 'Alexandra Catherine Montgomery-Wellington',
    email: 'alexandra.catherine.montgomery.wellington@example.com',
  };
  const errors = await mockAccount(page, user);
  await page.goto('/');
  const trigger = page.getByRole('button', { name: `Account: ${user.displayName}` });
  const dialog = page.getByRole('dialog', { name: 'Your account' });

  for (const width of [320, 390, 640, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(trigger).toBeVisible();
    const targets = [
      trigger,
      ...(await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link').all()),
    ];
    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(user.displayName, { exact: true })).toBeVisible();
    await expect(dialog.getByText(user.email, { exact: true })).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  expect(errors).toEqual([]);
});

test('sign out prevents duplicate requests, keeps errors in the popover and allows retry', async ({
  page,
}) => {
  const errors = await mockAccount(page);
  let requests = 0;
  let finishFirst!: () => void;
  const firstRequest = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  await page.route('**/auth/logout', async (route) => {
    const headers = corsHeaders(route.request());
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    expect(route.request().method()).toBe('POST');
    requests += 1;
    if (requests === 1) {
      await firstRequest;
      return route.fulfill({
        status: 503,
        headers,
        json: { error: { code: 'HTTP_ERROR', message: 'Try again' } },
      });
    }
    return route.fulfill({ status: 204, headers });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Account: Alex Morgan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your account' });
  const signOut = dialog.getByRole('button', { name: 'Sign out', exact: true });
  await signOut.click();
  const pending = dialog.getByRole('button', { name: 'Signing out…' });
  await expect(pending).toHaveAttribute('aria-disabled', 'true');
  await pending.press('Enter');
  await expect.poll(() => requests).toBe(1);
  finishFirst();
  await expect(dialog.getByRole('alert')).toHaveText('Unable to sign out. Please try again.');
  await expect(signOut).toBeEnabled();
  await signOut.click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(requests).toBe(2);
  expect(errors).toEqual([]);
});
