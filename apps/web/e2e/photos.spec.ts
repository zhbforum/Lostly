import { test, expect } from '@playwright/test';
import { imageFixture } from '@api-tests/support/image-fixture';

test('creates a report with photos, reorders the cover and deletes a photo', async ({
  page,
  request,
}, testInfo) => {
  const email = `photos-${crypto.randomUUID()}@example.com`;
  const password = 'a long photo-only test password';
  const registered = await request.post('http://localhost:3000/auth/register', {
    headers: { 'X-CSRF-Protection': '1' },
    data: { email, password, displayName: 'Photo owner' },
  });
  expect(registered.status()).toBe(201);
  await page.goto('/listings/new?kind=found');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('E2E photo backpack');
  await page
    .getByLabel('Description', { exact: true })
    .fill('A backpack with two identifying photos.');
  await page.getByLabel('Location', { exact: true }).fill('Berlin library');
  // Date segments handle keyboard events; contenteditable fill is not portable to Firefox.
  await page.getByRole('spinbutton', { name: /month/i }).pressSequentially('9');
  await page.getByRole('spinbutton', { name: /day/i }).pressSequentially('1');
  await page.getByRole('spinbutton', { name: /year/i }).pressSequentially('2026');
  await expect(page.getByRole('spinbutton', { name: /month/i })).toHaveAttribute(
    'aria-valuenow',
    '9',
  );
  await expect(page.getByRole('spinbutton', { name: /day/i })).toHaveAttribute(
    'aria-valuenow',
    '1',
  );
  await expect(page.getByRole('spinbutton', { name: /year/i })).toHaveAttribute(
    'aria-valuenow',
    '2026',
  );
  const files = await Promise.all(
    ['#3155d9', '#f97316'].map(async (color, index) => {
      const file = await imageFixture('png', color);
      return {
        name: `photo-${index}.png`,
        mimeType: 'image/png',
        buffer: Buffer.from(await file.arrayBuffer()),
      };
    }),
  );
  const fileInput = page.getByLabel('Add photos', { exact: true });
  await fileInput.focus();
  const choosing = page.waitForEvent('filechooser');
  await fileInput.press('Space');
  await (await choosing).setFiles(files);
  const picker = fileInput.locator('..').locator('..');
  await expect(picker.getByRole('status')).toHaveAccessibleName('2 of 5 photo slots used');
  await picker.screenshot({ path: testInfo.outputPath('photo-picker-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await picker.screenshot({ path: testInfo.outputPath('photo-picker-mobile.png') });
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(
    true,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  let continueUploads!: () => void;
  const uploadGate = new Promise<void>((resolve) => {
    continueUploads = resolve;
  });
  await page.route('**/listings/*/images', async (route) => {
    await uploadGate;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Create report', exact: true }).click();
  try {
    const uploading = page.getByRole('button', { name: 'Uploading photos…', exact: true });
    const createAnother = page.getByRole('button', { name: 'Create another report', exact: true });
    for (const [action, cursor] of [
      [uploading, 'wait'],
      [createAnother, 'default'],
    ] as const) {
      await expect(action).toBeDisabled();
      await expect(action).toHaveCSS('cursor', cursor);
      await expect(action).toHaveCSS('opacity', '0.65');
      const background = await action.evaluate(
        (button) => getComputedStyle(button).backgroundColor,
      );
      await action.hover({ force: true });
      await expect(action).toHaveCSS('background-color', background);
      await page.mouse.down();
      try {
        await expect(action).toHaveCSS('background-color', background);
      } finally {
        await page.mouse.up();
      }
    }
  } finally {
    continueUploads();
  }
  await expect(page.getByText('2 of 2 photos uploaded.')).toBeVisible();
  await page.getByRole('link', { name: 'View report', exact: true }).click();
  const main = page.getByRole('img', { name: 'Report photo 1', exact: true });
  await expect(main).toBeVisible();
  await expect
    .poll(() => main.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  const reportUrl = page.url();
  const gallery = page.getByRole('region', { name: 'Report photos', exact: true });
  await gallery.screenshot({ path: testInfo.outputPath('photo-gallery-desktop.png') });
  const disclosure = page.locator('summary').filter({ hasText: 'Manage photos' });
  await expect(page.getByRole('button', { name: 'Delete photo 1', exact: true })).toBeHidden();
  await disclosure.focus();
  await disclosure.press('Enter');
  const secondSrc = await page
    .getByRole('img', { name: 'Photo 2', exact: true })
    .getAttribute('src');
  const makeCover = page.getByRole('button', { name: 'Make photo 2 cover' });
  await makeCover.focus();
  await makeCover.press('Enter');
  await expect(page.getByText('Cover photo updated.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your photos' })).toBeFocused();
  const cover = page.getByRole('img', { name: 'Photo 1, cover', exact: true });
  const objectPath = (url: string) => new URL(url).pathname;
  expect(objectPath((await cover.getAttribute('src'))!)).toBe(objectPath(secondSrc!));
  await gallery
    .locator('..')
    .screenshot({ path: testInfo.outputPath('photo-management-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await gallery
    .locator('..')
    .screenshot({ path: testInfo.outputPath('photo-management-mobile.png') });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(
      true,
    );
    const remove = await page
      .getByRole('button', { name: 'Delete photo 1', exact: true })
      .boundingBox();
    expect(remove?.width).toBeGreaterThanOrEqual(44);
    expect(remove?.height).toBeGreaterThanOrEqual(44);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('link', { name: 'Back to results', exact: true }).click();
  const cardImage = page.locator(`a[href="${new URL(reportUrl).pathname}"]`).locator('img');
  await expect
    .poll(async () => objectPath((await cardImage.getAttribute('src'))!))
    .toBe(objectPath(secondSrc!));
  await expect
    .poll(() => cardImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await page.goto(reportUrl);
  await page.locator('summary').filter({ hasText: 'Manage photos' }).click();
  await page.getByRole('button', { name: 'Delete photo 1', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this photo?' });
  await expect(dialog.getByRole('button', { name: 'Keep photo' })).toBeFocused();
  await dialog.screenshot({ path: testInfo.outputPath('photo-delete-confirmation.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Delete photo 1', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Delete photo 1', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete photo', exact: true }).click();
  await expect(page.getByText('Photo deleted.')).toBeVisible();
  await page.reload();
  await page.locator('summary').filter({ hasText: 'Manage photos' }).click();
  await expect(page.getByRole('button', { name: 'Delete photo 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete photo 2', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show photo 2', exact: true })).toHaveCount(0);

  // Stay in the same manager instance: completed uploads must not leak into later batches.
  await fileInput.setInputFiles(files[0]);
  await page.getByRole('button', { name: 'Upload photos', exact: true }).click();
  await expect(page.getByText('Photo uploaded.', { exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Photos uploaded' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete photo 2', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete photo', exact: true }).click();
  await expect(page.getByText('Photo deleted.')).toBeVisible();
  await fileInput.setInputFiles(files[1]);
  await expect(page.getByText('0 of 1 photos uploaded.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Upload photos', exact: true }).click();
  await expect(page.getByText('Photo uploaded.', { exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Photos uploaded' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Show photo 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show photo 2', exact: true }).click();
  await expect
    .poll(() =>
      page
        .getByRole('img', { name: 'Report photo 2', exact: true })
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
});
