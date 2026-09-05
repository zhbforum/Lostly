import { test, expect } from '@playwright/test';

test('signs in, returns to the requested form, creates and opens a report', async ({
  page,
  request,
}) => {
  const email = `e2e-${crypto.randomUUID()}@example.com`;
  const password = 'a long e2e-only password';
  const registration = await request.post('http://localhost:3000/auth/register', {
    headers: { 'X-CSRF-Protection': '1' },
    data: { email, password, displayName: 'E2E user' },
  });
  expect(registration.status()).toBe(201);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/listings/new?kind=found');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/listings\/new\?kind=found$/);
  await page.getByLabel('Title', { exact: true }).fill('E2E blue backpack');
  await page
    .getByLabel('Description', { exact: true })
    .fill('A blue backpack found beside the library.');
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
  expect(errors).toEqual([]);
});
