import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test('signs in, reviews all overviews, rejects a claim and archives a report', async ({
  page,
  request,
}) => {
  const email = `admin-e2e-${crypto.randomUUID()}@example.com`;
  const password = 'a long admin e2e-only password';
  const csrf = { 'X-CSRF-Protection': '1' };
  const register = await request.post('http://localhost:3000/auth/register', {
    headers: csrf,
    data: { email, password, displayName: 'E2E moderator' },
  });
  expect(register.status()).toBe(201);
  const { user } = await register.json();
  // Role assignment stays outside HTTP. This subprocess inherits the dedicated test DB.
  execFileSync(
    'bun',
    [
      '-e',
      `
    import { SQL } from 'bun';
    if (new URL(process.env.DATABASE_URL).pathname !== '/lostly_test') throw new Error('Test DB required');
    const db = new SQL(process.env.DATABASE_URL);
    await db\`update users set role = 'admin' where id = \${process.argv[1]}::uuid\`;
    await db.close();
  `,
      user.id,
    ],
    { stdio: 'pipe', windowsHide: true },
  );

  const ownerEmail = `owner-e2e-${crypto.randomUUID()}@example.com`;
  expect(
    (
      await request.post('http://localhost:3000/auth/register', {
        headers: csrf,
        data: { email: ownerEmail, password, displayName: 'E2E finder' },
      })
    ).status(),
  ).toBe(201);
  const create = await request.post('http://localhost:3000/listings', {
    headers: csrf,
    data: {
      kind: 'found',
      title: 'E2E moderation backpack',
      description: 'Found near the library.',
      location: 'Berlin library',
      occurredOn: '2026-09-01',
    },
  });
  expect(create.status()).toBe(201);
  const { listing } = await create.json();
  expect(
    (
      await request.post('http://localhost:3000/auth/login', {
        headers: csrf,
        data: { email, password },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post(`http://localhost:3000/listings/${listing.id}/claims`, {
        headers: csrf,
        data: { verificationDetails: 'Private proof should never appear in admin.' },
      })
    ).status(),
  ).toBe(201);

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/claims');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Email', { exact: true }).fill(ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('does not have administrator access');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Moderation dashboard' })).toBeVisible();

  await page.getByRole('link', { name: 'Users', exact: true }).click();
  await expect(page.getByRole('cell', { name: email, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Claims', exact: true }).click();
  const claimRow = page.getByRole('row').filter({ hasText: listing.id });
  await expect(claimRow).toBeVisible();
  await expect(page.getByText('Private proof should never appear in admin.')).toHaveCount(0);
  await claimRow.getByRole('button', { name: 'Reject' }).click();
  const reject = page.getByRole('dialog', { name: 'Reject claim?' });
  await expect(reject).toBeVisible();
  await expect(reject.getByLabel('Moderation reason')).toBeFocused();
  await reject.getByLabel('Moderation reason').fill('E2E duplicate claim');
  await reject.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(reject).not.toBeVisible();
  await expect(claimRow.getByRole('cell', { name: 'rejected', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Listings', exact: true }).click();
  const report = page.getByRole('row').filter({ hasText: listing.id });
  await report.getByRole('button', { name: 'Archive' }).click();
  const archive = page.getByRole('dialog', { name: 'Archive listing?' });
  await archive.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(report.getByRole('cell', { name: 'active', exact: true })).toBeVisible();
  await report.getByRole('button', { name: 'Archive' }).click();
  await archive.getByLabel('Moderation reason').fill('E2E duplicate report');
  await archive.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(report.getByRole('cell', { name: 'archived', exact: true })).toBeVisible();
  await page.reload();
  await expect(report.getByRole('cell', { name: 'archived', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/users');
  await expect(page).toHaveURL(/\/login/);
  expect(errors).toEqual([]);
});
