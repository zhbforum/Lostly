import { test, expect } from '@playwright/test';
import { gifFixture } from '@api-tests/support/image-fixture';

test('profile persists a weekly name change, bio and GIF avatar through the real API', async ({
  page,
  request,
  browser,
}, testInfo) => {
  const email = `profile-${crypto.randomUUID()}@example.com`;
  const password = 'a long profile-only test password';
  const username = `alex_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const registered = await request.post(
    `http://localhost:${process.env.TEST_API_PORT ?? 3000}/auth/register`,
    {
      headers: { 'X-CSRF-Protection': '1' },
      data: { email, password, displayName: 'Alex Morgan' },
    },
  );

  expect(registered.status()).toBe(201);

  const { user } = await registered.json();

  await page.goto('/profile/edit');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  const name = page.getByLabel('Display name', { exact: true });

  await test.step('Save identity fields and apply their weekly change limits', async () => {
    await expect(name).toHaveValue('Alex Morgan');
    await expect(page.getByText(/Member since/)).toBeVisible();

    await name.fill('Alex Rivers');
    await page.getByRole('textbox', { name: /Username/ }).fill(username);

    await expect(page.getByText('Available — reserved when you save.')).toBeVisible();

    await page
      .getByRole('textbox', { name: /Bio/ })
      .fill('Usually around the library. Happy to help things find their way home.');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();

    await expect(page.getByRole('status', { name: 'Profile save status' })).toHaveText(
      'Changes saved.',
    );
    await expect(name).toHaveAttribute('readonly', '');
    await expect(page.getByRole('textbox', { name: /Username/ })).toHaveAttribute('readonly', '');
    await expect(page.getByText(/You can change your name again on/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account: Alex Rivers' })).toBeVisible();
  });

  await test.step('Upload a GIF avatar and play its animation', async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload photo', exact: true }).click();

    const gif = await gifFixture();
    await (
      await chooser
    ).setFiles({
      name: gif.name,
      mimeType: gif.type,
      buffer: Buffer.from(await gif.arrayBuffer()),
    });

    const dialog = page.getByRole('dialog', { name: 'Update profile photo' });
    await expect(dialog.getByAltText('New profile preview')).toBeVisible();

    await dialog.getByRole('button', { name: 'Save photo', exact: true }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status', { name: 'Profile save status' })).toHaveText(
      'Profile photo updated.',
    );

    await page.getByRole('button', { name: 'Play animation' }).click();

    await expect(page.getByRole('button', { name: 'Pause animation' })).toBeVisible();
  });

  const photo = page.getByRole('region', { name: 'Profile photo' }).locator('img');

  await test.step('Retain profile values and reset animation playback after reload', async () => {
    await expect
      .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(256);

    await page.screenshot({ path: testInfo.outputPath('profile-persisted.png'), fullPage: true });
    await page.reload();

    await expect(name).toHaveValue('Alex Rivers');
    await expect(page.getByRole('textbox', { name: /Username/ })).toHaveValue(username);
    await expect(page.getByRole('textbox', { name: /Bio/ })).toHaveValue(
      'Usually around the library. Happy to help things find their way home.',
    );
    await expect(page.getByRole('button', { name: 'Play animation' })).toBeVisible();
  });

  const guest = await browser.newContext();

  try {
    await test.step('Expose the saved public profile without account-only information', async () => {
      const publicPage = await guest.newPage();
      await publicPage.goto(new URL(`/users/${user.id}`, page.url()).href);

      await expect(publicPage.getByRole('heading', { name: 'Alex Rivers' })).toBeVisible();
      await expect(publicPage).toHaveURL(new URL(`/u/${username}`, page.url()).href);
      await expect(publicPage.getByText(`@${username}`, { exact: true })).toBeVisible();
      await expect(
        publicPage.getByText(
          'Usually around the library. Happy to help things find their way home.',
        ),
      ).toBeVisible();
      await expect(publicPage.getByRole('link', { name: 'Edit profile' })).toHaveCount(0);
      await expect(publicPage.getByText(email)).toHaveCount(0);
      await expect(publicPage.getByRole('button', { name: 'Play animation' })).toBeVisible();
      await expect
        .poll(() =>
          publicPage
            .locator('article img')
            .evaluate((image: HTMLImageElement) => image.naturalWidth),
        )
        .toBe(256);

      await publicPage.screenshot({
        path: testInfo.outputPath('public-profile-persisted.png'),
        fullPage: true,
      });
    });
  } finally {
    await guest.close();
  }

  await test.step('Remove the avatar and edit the bio while identity fields are locked', async () => {
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Remove profile photo?' })
      .getByRole('button', { name: 'Remove photo', exact: true })
      .click();

    await expect(page.getByRole('button', { name: 'Upload photo', exact: true })).toBeVisible();
    await expect(photo).toHaveCount(0);

    await page
      .getByRole('textbox', { name: /Bio/ })
      .fill('An updated bio while my name is locked.');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();

    await expect(page.getByRole('status', { name: 'Profile save status' })).toHaveText(
      'Changes saved.',
    );
  });
});
