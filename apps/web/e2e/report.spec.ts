import { test, expect } from '@playwright/test';

test('creates, edits, resolves, archives and reopens report history', async ({ page, request }) => {
  const email = `e2e-${crypto.randomUUID()}@example.com`;
  const password = 'a long e2e-only password';
  const registration = await request.post('http://localhost:3000/auth/register', {
    headers: { 'X-CSRF-Protection': '1' },
    data: { email, password, displayName: 'E2E user' },
  });
  expect(registration.status()).toBe(201);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/listings/new?kind=lost');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/listings\/new\?kind=lost$/);
  await page.getByLabel('Title', { exact: true }).fill('E2E blue backpack');
  await page
    .getByLabel('Description', { exact: true })
    .fill('A blue backpack lost beside the library.');
  await page.getByLabel('Location', { exact: true }).fill('Berlin library');
  await page.getByRole('spinbutton', { name: /month/i }).fill('9');
  await page.getByRole('spinbutton', { name: /day/i }).fill('1');
  await page.getByRole('spinbutton', { name: /year/i }).fill('2026');
  await page.getByRole('button', { name: 'Create report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your report was created.' })).toBeVisible();
  await page.getByRole('link', { name: 'View report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E blue backpack', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/listings\/[0-9a-f-]+$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'E2E blue backpack', exact: true })).toBeVisible();
  const reportUrl = page.url();

  await page.getByRole('link', { name: 'Edit report', exact: true }).click();
  await expect(page).toHaveURL(/\/listings\/[0-9a-f-]+\/edit$/);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('E2E blue backpack');
  await expect(page.getByText('Report type cannot be changed after publication.')).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill('E2E edited backpack');
  await page
    .getByLabel('Description', { exact: true })
    .fill('Updated description: a blue backpack with a red zip.');
  await page.getByLabel('Location', { exact: true }).fill('Berlin central library');
  await page.getByRole('spinbutton', { name: /day/i }).fill('2');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page).toHaveURL(reportUrl);
  await expect(
    page.getByRole('heading', { name: 'E2E edited backpack', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Updated description: a blue backpack with a red zip.'),
  ).toBeVisible();
  await expect(page.getByText('Berlin central library', { exact: true })).toBeVisible();
  await expect(page.getByText('Your report was updated.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'E2E edited backpack', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Your report was updated.', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Mark as resolved', exact: true }).click();
  const resolveDialog = page.getByRole('dialog', { name: 'Mark this report as resolved?' });
  await expect(resolveDialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await resolveDialog.getByRole('button', { name: 'Mark as resolved', exact: true }).click();
  await expect(page.getByText('Resolved', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit report', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to results', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E edited backpack', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('link', { name: 'My activity', exact: true }).click();
  await page.getByRole('link', { name: 'My reports', exact: true }).click();
  await page.getByRole('link', { name: /E2E edited backpack/ }).click();
  await expect(page.getByText('Resolved', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Archive report', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Archive this report?' })
    .getByRole('button', { name: 'Archive report', exact: true })
    .click();
  await expect(page.getByText('Archived', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Archive report', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to results', exact: true }).click();
  await expect(page).toHaveURL(/\/activity\?tab=reports$/);
  await page.getByRole('link', { name: /E2E edited backpack/ }).click();
  await expect(page).toHaveURL(reportUrl);
  await page.reload();
  await expect(page.getByText('Archived', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'E2E edited backpack', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit report', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark as resolved', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Archive report', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
