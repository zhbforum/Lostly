import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { imageFixture } from '../../api/tests/support/image-fixture';

test('filters, paginates, hides and restores listings, then moderates claims and archives', async ({
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
    await db\`insert into listings (created_by_user_id, kind, title, description, location, occurred_on)
      select \${process.argv[1]}::uuid, 'lost', 'Pagination ' || \${process.argv[1]} || ' ' || i, 'Test report', 'Berlin', '2026-09-01'
      from generate_series(1, 21) i\`;
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
      title: 'E2E moderation backpack ' + crypto.randomUUID().slice(0, 8),
      description: 'Found near the library.',
      location: 'Berlin library',
      occurredOn: '2026-09-01',
    },
  });
  expect(create.status()).toBe(201);
  const { listing } = await create.json();
  const photo = await imageFixture();
  expect(
    (
      await request.post(`http://localhost:3000/listings/${listing.id}/images`, {
        headers: { ...csrf, 'Idempotency-Key': crypto.randomUUID() },
        multipart: {
          file: {
            name: 'report.png',
            mimeType: 'image/png',
            buffer: Buffer.from(await photo.arrayBuffer()),
          },
        },
      })
    ).status(),
  ).toBe(201);
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
  await expect(page.getByRole('heading', { name: 'Claims', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Moderation dashboard' })).toBeVisible();

  await page.getByRole('link', { name: 'Users', exact: true }).click();
  await page.getByLabel('Search users').fill(email);
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel('Search users')).toHaveValue(email);
  await expect(page.getByRole('cell', { name: email, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Claims', exact: true }).click();
  const claimRow = page.getByRole('row').filter({ hasText: listing.id });
  await page.getByLabel('Status', { exact: true }).selectOption('pending');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/status=pending/);
  await expect(claimRow).toBeVisible();
  await expect(page.getByText('Private proof should never appear in admin.')).toHaveCount(0);
  await claimRow.getByRole('button', { name: 'Reject' }).click();
  const reject = page.getByRole('dialog', { name: 'Reject claim?' });
  await expect(reject).toBeVisible();
  await expect(reject.getByLabel('Moderation reason')).toBeFocused();
  await reject.getByLabel('Moderation reason').fill('E2E duplicate claim');
  await reject.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(reject).not.toBeVisible();
  await expect(claimRow).toHaveCount(0);
  await page.getByLabel('Status', { exact: true }).selectOption('rejected');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(claimRow.getByRole('cell', { name: 'rejected', exact: true })).toBeVisible();
  await claimRow.getByText('Moderation history', { exact: true }).click();
  await expect(claimRow.getByText('E2E duplicate claim', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Listings', exact: true }).click();
  await page.getByLabel('Search listings').fill('Pagination ' + user.id);
  await page.getByLabel('Type', { exact: true }).selectOption('lost');
  await page.getByLabel('Status', { exact: true }).selectOption('active');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(20);
  const firstPage = page.url();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByLabel('Search listings')).toHaveValue('Pagination ' + user.id);
  await page.goBack();
  await expect(page).toHaveURL(firstPage);
  await expect(page.locator('tbody tr')).toHaveCount(20);
  await page.getByLabel('Search listings').fill(listing.title);
  await page.getByLabel('Type', { exact: true }).selectOption('found');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  const report = page.getByRole('row').filter({ hasText: listing.id });
  await report.getByRole('button', { name: 'Hide', exact: true }).click();
  const hide = page.getByRole('dialog', { name: 'Hide listing?' });
  await expect(hide.getByLabel('Moderation reason')).toBeFocused();
  await hide.getByLabel('Moderation reason').fill('Review unsafe report');
  await hide.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(report.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
  expect((await request.get('http://localhost:3000/listings/' + listing.id)).status()).toBe(404);
  await page.getByLabel('Visibility', { exact: true }).selectOption('visible');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(report).toHaveCount(0);
  await page.getByLabel('Visibility', { exact: true }).selectOption('hidden');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await page.reload();
  await report.getByText('Photos and moderation history', { exact: true }).click();
  await expect(report.getByText('Review unsafe report', { exact: true })).toBeVisible();
  const preview = report.getByRole('img', { name: /Report photo 1/ });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveJSProperty('naturalWidth', 32);
  await report.getByRole('button', { name: 'Restore', exact: true }).click();
  const restore = page.getByRole('dialog', { name: 'Restore listing?' });
  await restore.getByLabel('Moderation reason').fill('Reviewed and allowed');
  await restore.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(report).toHaveCount(0);
  expect((await request.get('http://localhost:3000/listings/' + listing.id)).status()).toBe(200);
  await page.getByLabel('Visibility', { exact: true }).selectOption('visible');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await report.getByRole('button', { name: 'Archive' }).click();
  const archive = page.getByRole('dialog', { name: 'Archive listing?' });
  await archive.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(report.getByText('active', { exact: true })).toBeVisible();
  await report.getByRole('button', { name: 'Archive' }).click();
  await archive.getByLabel('Moderation reason').fill('E2E duplicate report');
  await archive.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(report).toHaveCount(0);
  await page.getByLabel('Status', { exact: true }).selectOption('archived');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(report.getByText('archived', { exact: true })).toBeVisible();
  await page.reload();
  await expect(report.getByText('archived', { exact: true })).toBeVisible();
  const destination = page.url();
  expect((await page.request.post('/api/auth/logout', { headers: csrf })).status()).toBe(204);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?reason=expired/);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(destination);
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('archived');
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
