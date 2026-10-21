import { test, expect } from '@playwright/test';
import type { UserProfile } from '@lostly/contracts/profile';
import { corsHeaders } from './support/cors-headers.ts';

const profile: UserProfile = {
  id: 'google-link-user',
  username: 'alex_morgan',
  displayName: 'Alex Morgan',
  bio: '',
  createdAt: '2026-01-01T12:00:00Z',
  nextDisplayNameChangeAt: null,
  nextUsernameChangeAt: null,
  version: 1,
  avatar: null,
};

for (const mode of ['login', 'link'] as const) {
  test(`Google ${mode} navigates to the authorization URL returned by the API`, async ({
    page,
  }) => {
    const returnTo = mode === 'login' ? '/listings/new?kind=found#photos' : '/profile';
    const authorizationUrl = `https://identity.example.test/authorize?state=${mode}-state&scope=openid%20email`;
    const errors: string[] = [];
    const starts: unknown[] = [];

    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const request = route.request();
      const headers = corsHeaders(request);
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (!['fetch', 'xhr'].includes(request.resourceType())) return route.continue();
      const path = new URL(request.url()).pathname;

      if (path === '/auth/me')
        return mode === 'link'
          ? route.fulfill({
              headers,
              json: {
                user: {
                  id: profile.id,
                  username: profile.username,
                  displayName: profile.displayName,
                  email: 'alex@example.com',
                  role: 'user',
                  avatar: profile.avatar,
                  profileVersion: profile.version,
                },
              },
            })
          : route.fulfill({
              status: 401,
              headers,
              json: { error: { code: 'UNAUTHENTICATED', message: 'Sign in' } },
            });
      if (path === '/auth/providers')
        return route.fulfill({ headers, json: { google: { enabled: true, linked: false } } });
      if (path === '/me/profile') return route.fulfill({ headers, json: { profile } });
      if (path === '/me/conversations/unread-count')
        return route.fulfill({ headers, json: { unreadConversationCount: 0 } });
      if (path === '/auth/google/start') {
        expect(request.method()).toBe('POST');
        starts.push(request.postDataJSON());
        return route.fulfill({ headers, json: { url: authorizationUrl } });
      }
      errors.push(`Unexpected request: ${request.method()} ${path}`);
      return route.fulfill({ status: 404, headers });
    });
    await page.route('https://identity.example.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><h1>Controlled authorization endpoint</h1></body></html>',
      }),
    );

    await test.step('Reach the appropriate Google entry point', async () => {
      await page.goto(mode === 'login' ? returnTo : '/profile/edit');

      if (mode === 'login') await expect(page).toHaveURL(/\/login$/);
      else await expect(page.getByRole('heading', { name: 'Edit profile' })).toBeVisible();
    });

    await test.step('Start the requested OAuth mode and follow the exact authorization URL', async () => {
      await page
        .getByRole('button', { name: mode === 'login' ? 'Continue with Google' : 'Connect Google' })
        .click();

      await expect(page).toHaveURL(authorizationUrl);
      await expect(
        page.getByRole('heading', { name: 'Controlled authorization endpoint' }),
      ).toBeVisible();
      expect(starts).toEqual([{ mode, returnTo }]);
      expect(errors).toEqual([]);
    });
  });
}
