import { test, expect, type Page } from '@playwright/test';
import type { UserProfile } from '@lostly/contracts/profile';
import { corsHeaders } from './support/cors-headers.ts';
import { pngImage } from './support/conversation-images.ts';
import { gifFixture } from '@api-tests/support/image-fixture';

const initial: UserProfile = {
  id: 'user',
  displayName: 'Alex Morgan',
  username: null,
  bio: 'Usually around the library. Happy to help things find their way home.',
  createdAt: '2026-09-01T12:00:00.000Z',
  nextDisplayNameChangeAt: null,
  nextUsernameChangeAt: null,
  version: 1,
  avatar: null,
};

async function mockProfile(page: Page, profile = initial, guest = false) {
  let current = structuredClone(profile);
  let failSave = false;
  let takeUsernameOnSave = false;
  const aliases = new Set<string>(profile.username ? [profile.username] : []);
  const errors: string[] = [];
  const writes: unknown[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://avatars.test/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: pngImage(256, 256, 105) }),
  );
  await page.route('**/*', async (route) => {
    const request = route.request();
    const headers = corsHeaders(request);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (!['fetch', 'xhr'].includes(request.resourceType())) return route.fallback();
    const path = new URL(request.url()).pathname;
    if (path === '/auth/me' && guest)
      return route.fulfill({
        status: 401,
        headers,
        json: { error: { code: 'UNAUTHENTICATED', message: 'Sign in' } },
      });
    if (
      path === `/users/${current.id}` ||
      (path.startsWith('/u/') && aliases.has(path.slice(3).toLowerCase()))
    ) {
      const { id, username, displayName, bio, createdAt, avatar } = current;
      return route.fulfill({
        headers,
        json: { profile: { id, username, displayName, bio, createdAt, avatar } },
      });
    }
    if (path.startsWith('/users/') || path.startsWith('/u/'))
      return route.fulfill({
        status: 404,
        headers,
        json: { error: { code: 'PROFILE_NOT_FOUND', message: 'Profile not found' } },
      });
    if (path === '/auth/me')
      return route.fulfill({
        headers,
        json: {
          user: {
            id: current.id,
            email: 'alex.morgan@example.com',
            displayName: current.displayName,
            username: current.username,
            role: 'user',
            avatar: current.avatar,
            profileVersion: current.version,
          },
        },
      });
    if (path === '/me/conversations/unread-count')
      return route.fulfill({ headers, json: { unreadConversationCount: 2 } });
    if (path.startsWith('/me/profile/username/')) {
      const username = path.split('/').at(-1)!;
      return route.fulfill({
        headers,
        json: {
          username,
          available: username !== 'already_taken',
          reason: username === 'already_taken' ? 'taken' : null,
        },
      });
    }
    if (path === '/me/profile') {
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON();
        writes.push(body);
        if (body.expectedVersion !== current.version)
          return route.fulfill({
            status: 409,
            headers,
            json: { error: { code: 'PROFILE_CHANGED', message: 'Profile changed' } },
          });
        if (failSave) {
          failSave = false;
          return route.fulfill({
            status: 503,
            headers,
            json: { error: { code: 'HTTP_ERROR', message: 'Unavailable' } },
          });
        }
        if (body.username && takeUsernameOnSave) {
          takeUsernameOnSave = false;
          return route.fulfill({
            status: 409,
            headers,
            json: {
              error: {
                code: 'USERNAME_TAKEN',
                message: 'This username is not available. Please choose another.',
              },
            },
          });
        }
        if (body.username) aliases.add(body.username);
        current = {
          ...current,
          displayName: body.displayName,
          username: body.username ?? current.username,
          nextUsernameChangeAt:
            body.username && body.username !== current.username
              ? new Date(Date.now() + 30 * 86400000).toISOString()
              : current.nextUsernameChangeAt,
          bio: body.bio,
          version: current.version + 1,
          nextDisplayNameChangeAt:
            body.displayName !== current.displayName
              ? new Date(Date.now() + 604800000).toISOString()
              : current.nextDisplayNameChangeAt,
        };
      }
      return route.fulfill({ headers, json: { profile: current } });
    }
    if (path === '/me/profile/avatar') {
      const form =
        request.method() === 'POST'
          ? await new Response(new Uint8Array(request.postDataBuffer()!), {
              headers: { 'Content-Type': request.headers()['content-type']! },
            }).formData()
          : null;
      if (
        (form ? Number(form.get('expectedVersion')) : request.postDataJSON().expectedVersion) !==
        current.version
      )
        return route.fulfill({
          status: 409,
          headers,
          json: { error: { code: 'PROFILE_CHANGED', message: 'Profile changed' } },
        });
      current = {
        ...current,
        version: current.version + 1,
        avatar: form
          ? {
              id: 'avatar',
              animated: (form.get('file') as File).type === 'image/gif',
              url: 'https://avatars.test/animated.webp',
              staticUrl: 'https://avatars.test/still.webp',
              urlExpiresAt: new Date(Date.now() + 3600000).toISOString(),
            }
          : null,
      };
      return route.fulfill({ headers, json: { profile: current } });
    }
    errors.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, headers });
  });
  return {
    errors,
    writes,
    remoteChange: (change: Partial<UserProfile>) => {
      if (change.username) aliases.add(change.username);
      current = { ...current, ...change, version: current.version + 1 };
    },
    failNextSave: () => {
      failSave = true;
    },
    takeUsernameOnSave: () => {
      takeUsernameOnSave = true;
    },
  };
}

test('profile is reachable from the account, adapts to narrow screens and saves name and bio', async ({
  page,
}, testInfo) => {
  const server = await mockProfile(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Account: Alex Morgan' }).click();
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Alex Morgan', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/users\/user$/);
  await page.screenshot({ path: testInfo.outputPath('public-profile.png'), fullPage: true });
  await page.getByRole('link', { name: 'Edit profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit profile', exact: true })).toBeVisible();
  const name = page.getByLabel('Display name', { exact: true });
  await expect(name).toHaveValue('Alex Morgan');
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('profile.png'), fullPage: true });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await name.fill('Alex Rivers');
  await page
    .getByRole('textbox', { name: /Bio/ })
    .fill('Coffee, walks and helping things find their way home.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Profile save status' })).toHaveText(
    'Changes saved.',
  );
  await expect(name).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: 'Account: Alex Rivers' })).toBeVisible();
  await expect(page.getByText(/You can change your name again on/)).toBeVisible();
  await page.reload();
  await expect(name).toHaveValue('Alex Rivers');
  expect(server.errors).toEqual([]);
});

test('failed saves retain edits, navigation retains a draft and locked names still allow bio edits', async ({
  page,
}) => {
  const server = await mockProfile(page, {
    ...initial,
    nextDisplayNameChangeAt: new Date(Date.now() + 86400000).toISOString(),
  });
  await page.goto('/profile/edit');
  await expect(page.getByLabel('Display name', { exact: true })).toHaveAttribute('readonly', '');
  const bio = page.getByRole('textbox', { name: /Bio/ });
  await bio.fill('A new introduction.');
  await page.getByRole('textbox', { name: /Username/ }).fill('alex_draft');
  await page.getByRole('link', { name: 'Lostly home' }).click();
  await page.getByRole('button', { name: 'Account: Alex Morgan' }).click();
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await page.getByRole('link', { name: 'Edit profile', exact: true }).click();
  await expect(bio).toHaveValue('A new introduction.');
  await expect(page.getByRole('textbox', { name: /Username/ })).toHaveValue('alex_draft');
  server.failNextSave();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('We could not save');
  await expect(bio).toHaveValue('A new introduction.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Profile save status' })).toHaveText(
    'Changes saved.',
  );
  expect(server.writes).toHaveLength(2);
  expect(server.errors).toEqual([]);
});

test('GIF preview is keyboard accessible, saves to the header and respects reduced motion', async ({
  page,
}) => {
  const server = await mockProfile(page);
  await page.goto('/profile/edit');
  const button = page.getByRole('button', { name: 'Upload photo', exact: true });
  await button.focus();
  const chooser = page.waitForEvent('filechooser');
  await button.press('Enter');
  const gif = await gifFixture();
  await (
    await chooser
  ).setFiles({ name: gif.name, mimeType: gif.type, buffer: Buffer.from(await gif.arrayBuffer()) });
  const dialog = page.getByRole('dialog', { name: 'Update profile photo' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByAltText('Preview of your new profile photo')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save photo', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change photo', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Play animation' }).click();
  const photo = page.getByRole('region', { name: 'Profile photo' }).locator('img');
  await expect(photo).toHaveAttribute('src', 'https://avatars.test/animated.webp');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Pause animation' })).toBeHidden();
  await expect
    .poll(() => photo.evaluate((image: HTMLImageElement) => image.currentSrc))
    .toBe('https://avatars.test/still.webp');
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('button', { name: 'Remove photo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Upload photo', exact: true })).toBeVisible();
  expect(server.errors).toEqual([]);
});

async function choosePngWithoutMime(page: Page) {
  const bytes = Array.from(pngImage(32, 32, 105));
  await page.locator('input[type=file]').evaluate((element, bytes) => {
    const transfer = new DataTransfer();
    const file = new File([new Uint8Array(bytes)], 'photo.png');
    if (file.type !== '') throw new Error('The regression requires an empty MIME type');
    transfer.items.add(file);
    (element as HTMLInputElement).files = transfer.files;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, bytes);
}

test('a valid PNG with an empty File.type reaches preview and upload', async ({ page }) => {
  const server = await mockProfile(page);
  await page.goto('/profile/edit');
  await expect(page.getByLabel('Display name', { exact: true })).toBeVisible();
  await choosePngWithoutMime(page);
  const dialog = page.getByRole('dialog', { name: 'Update profile photo' });
  await expect(dialog.getByAltText('Preview of your new profile photo')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save photo', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Profile save status' })).toHaveText(
    'Profile photo updated.',
  );
  expect(server.errors).toEqual([]);
});

for (const action of ['text save', 'avatar upload'] as const) {
  test(`remote avatar-only change does not discard an unsaved display-name draft after ${action}`, async ({
    page,
  }) => {
    const server = await mockProfile(page);
    await page.goto('/profile/edit');
    const name = page.getByLabel('Display name', { exact: true });
    await name.fill('My unsaved name');
    await page.getByRole('textbox', { name: /Username/ }).fill('my_unsaved_username');
    await page.getByRole('textbox', { name: /Bio/ }).fill('My unsaved bio');
    server.remoteChange({
      avatar: {
        id: 'remote-avatar',
        animated: false,
        url: 'https://avatars.test/remote.webp',
        staticUrl: 'https://avatars.test/remote.webp',
        urlExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
    });
    if (action === 'text save')
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    else {
      await choosePngWithoutMime(page);
      await page.getByRole('button', { name: 'Save photo', exact: true }).click();
    }
    await expect(page.getByRole('alert')).toContainText('changed elsewhere');
    if (action === 'avatar upload')
      await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
    await expect(name).toHaveValue('My unsaved name');
    await expect(page.getByRole('textbox', { name: /Username/ })).toHaveValue(
      'my_unsaved_username',
    );
    await expect(page.getByRole('textbox', { name: /Bio/ })).toHaveValue('My unsaved bio');
    await expect(name).not.toHaveAttribute('readonly', '');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Profile save status' })).toHaveText(
      'Changes saved.',
    );
    expect(server.writes.at(-1)).toMatchObject({
      displayName: 'My unsaved name',
      username: 'my_unsaved_username',
      bio: 'My unsaved bio',
      expectedVersion: 2,
    });
    expect(server.errors).toEqual([]);
  });
}

test('a conflicting server name replaces the draft and applies the weekly lock without losing bio', async ({
  page,
}) => {
  const server = await mockProfile(page);
  await page.goto('/profile/edit');
  const name = page.getByLabel('Display name', { exact: true });
  await name.fill('Local name');
  await page.getByRole('textbox', { name: /Bio/ }).fill('Keep this bio');
  server.remoteChange({
    displayName: 'Name from another tab',
    nextDisplayNameChangeAt: new Date(Date.now() + 604800000).toISOString(),
  });
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed elsewhere');
  await expect(name).toHaveValue('Name from another tab');
  await expect(name).toHaveAttribute('readonly', '');
  await expect(page.getByRole('textbox', { name: /Bio/ })).toHaveValue('Keep this bio');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Profile save status' })).toHaveText(
    'Changes saved.',
  );
});

test('public profile is readable without signing in and offers no editing or private account details', async ({
  page,
}, testInfo) => {
  const server = await mockProfile(page, initial, true);
  await page.goto('/users/user');
  await expect(page.getByRole('heading', { name: 'Alex Morgan' })).toBeVisible();
  await expect(page.getByText(initial.bio)).toBeVisible();
  await expect(page.getByText(/Member since/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit profile' })).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByText('alex.morgan@example.com')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('public-guest.png'), fullPage: true });
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(server.errors).toEqual([]);
});

test('missing profiles show not-found and public viewing survives a failed session bootstrap', async ({
  page,
}) => {
  await mockProfile(page, initial, true);
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 503,
      headers: corsHeaders(route.request()),
      json: { error: { code: 'HTTP_ERROR', message: 'Unavailable' } },
    }),
  );
  await page.goto('/users/user');
  await expect(page.getByRole('heading', { name: 'Alex Morgan' })).toBeVisible();
  await page.goto('/users/missing');
  await expect(page.getByRole('heading', { name: 'Profile not found' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alex Morgan' })).toHaveCount(0);
});

test('choosing a username previews the canonical URL, updates account navigation and keeps the editor lightweight', async ({
  page,
}, testInfo) => {
  const server = await mockProfile(page);
  await page.goto('/profile/edit');
  const username = page.getByRole('textbox', { name: /Username/ });
  await expect(username).toHaveValue('');
  await username.fill('Alex_Morgan');
  await expect(page.getByText('Available — reserved when you save.')).toBeVisible();
  await expect(page.locator('#profile-username-link')).toContainText('/u/alex_morgan');
  await page.screenshot({ path: testInfo.outputPath('username-editor.png'), fullPage: true });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Profile save status' })).toHaveText(
    'Changes saved.',
  );
  await expect(username).toHaveValue('alex_morgan');
  await expect(username).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('Display name', { exact: true })).not.toHaveAttribute(
    'readonly',
    '',
  );
  await expect(page.getByText(/You can change your username again on/)).toBeVisible();
  await expect(page.getByRole('link', { name: /View public profile/ })).toHaveAttribute(
    'href',
    '/u/alex_morgan',
  );
  await page.getByRole('link', { name: /View public profile/ }).click();
  await expect(page).toHaveURL(/\/u\/alex_morgan$/);
  await expect(page.getByText('@alex_morgan', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit profile', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Account: Alex Morgan' }).click();
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await expect(page).toHaveURL(/\/u\/alex_morgan$/);
  expect(server.writes).toEqual([
    {
      displayName: initial.displayName,
      bio: initial.bio,
      username: 'alex_morgan',
      expectedVersion: 1,
    },
  ]);
  expect(server.errors).toEqual([]);
});

test('reserved, occupied and newly taken usernames show actionable errors without losing drafts', async ({
  page,
}) => {
  const server = await mockProfile(page);
  await page.goto('/profile/edit');
  const username = page.getByRole('textbox', { name: /Username/ });
  await username.fill('ADMIN');
  await expect(page.getByRole('alert')).toContainText('reserved');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(username).toBeFocused();
  expect(server.writes).toHaveLength(0);
  await username.fill('already_taken');
  await expect(page.getByRole('alert')).toContainText('not available');
  await username.fill('just_available');
  await expect(page.getByText('Available — reserved when you save.')).toBeVisible();
  await page.getByRole('textbox', { name: /Bio/ }).fill('Keep this bio draft');
  server.takeUsernameOnSave();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('not available');
  await expect(username).toBeFocused();
  await expect(username).toHaveValue('just_available');
  await expect(page.getByRole('textbox', { name: /Bio/ })).toHaveValue('Keep this bio draft');
  await username.fill('another_available');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Profile save status' })).toHaveText(
    'Changes saved.',
  );
  expect(server.errors).toEqual([]);
});

test('UUID, uppercase and historical public URLs replace with the current handle and copy only the canonical link', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          sessionStorage.setItem('copied-profile-link', value);
        },
      },
    });
  });
  const server = await mockProfile(page, { ...initial, username: 'alex_old' }, true);
  server.remoteChange({ username: 'alex_current' });
  for (const path of ['/users/user', '/u/alex_old', '/u/ALEX_CURRENT']) {
    await page.goto(path + '?ref=shared#about');
    await expect(page).toHaveURL(/\/u\/alex_current\?ref=shared#about$/);
    await expect(page.getByRole('heading', { name: 'Alex Morgan' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit profile' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Copy profile link' }).click();
    await expect(page.getByRole('status')).toHaveText('Profile link copied.');
    expect(await page.evaluate(() => sessionStorage.getItem('copied-profile-link'))).toBe(
      new URL('/u/alex_current', page.url()).href,
    );
  }
  await page.screenshot({ path: testInfo.outputPath('username-public.png'), fullPage: true });
  await page.goto('/u/missing_handle');
  await expect(page.getByRole('heading', { name: 'Profile not found' })).toBeVisible();
  expect(server.errors).toEqual([]);
});

test('a remotely changed username replaces only that draft and applies its independent lock', async ({
  page,
}) => {
  const server = await mockProfile(page);
  await page.goto('/profile/edit');
  const username = page.getByRole('textbox', { name: /Username/ });
  await username.fill('local_draft');
  await page.getByLabel('Display name', { exact: true }).fill('Keep my name draft');
  await page.getByRole('textbox', { name: /Bio/ }).fill('Keep my bio draft');
  server.remoteChange({
    username: 'remote_username',
    nextUsernameChangeAt: new Date(Date.now() + 30 * 86400000).toISOString(),
  });
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed elsewhere');
  await expect(username).toHaveValue('remote_username');
  await expect(username).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Keep my name draft');
  await expect(page.getByRole('textbox', { name: /Bio/ })).toHaveValue('Keep my bio draft');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Profile save status' })).toHaveText(
    'Changes saved.',
  );
  expect(server.writes.at(-1)).toEqual({
    displayName: 'Keep my name draft',
    bio: 'Keep my bio draft',
    expectedVersion: 2,
  });
  expect(server.errors).toEqual([]);
});

for (const action of ['text save', 'avatar upload'] as const) {
  for (const remoteBio of ['Bio updated in another tab.', '']) {
    test(`remote bio ${remoteBio ? 'update' : 'removal'} survives conflict recovery after ${action}`, async ({
      page,
    }) => {
      const server = await mockProfile(page);
      await page.goto('/profile/edit');
      const name = page.getByLabel('Display name', { exact: true });
      const username = page.getByRole('textbox', { name: /Username/ });
      const bio = page.getByRole('textbox', { name: /Bio/ });
      await name.fill('My local name');
      await username.fill('my_local_username');
      if (!remoteBio) await bio.fill('A conflicting local bio draft');
      server.remoteChange({ bio: remoteBio });
      if (action === 'text save')
        await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      else {
        await choosePngWithoutMime(page);
        await page.getByRole('button', { name: 'Save photo', exact: true }).click();
      }
      await expect(page.getByRole('alert')).toContainText('changed elsewhere');
      if (action === 'avatar upload')
        await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
      await expect(bio).toHaveValue(remoteBio);
      await expect(name).toHaveValue('My local name');
      await expect(username).toHaveValue('my_local_username');
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(page.getByRole('status', { name: 'Profile save status' })).toHaveText(
        'Changes saved.',
      );
      expect(server.writes.at(-1)).toEqual({
        displayName: 'My local name',
        username: 'my_local_username',
        bio: remoteBio,
        expectedVersion: 2,
      });
      await page.reload();
      await expect(bio).toHaveValue(remoteBio);
      expect(server.errors).toEqual([]);
    });
  }
}
