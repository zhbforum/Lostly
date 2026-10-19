import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { deferred } from '@/test/deferred';
import { userProfile } from '@/test/fixtures/profile';
import { TestSession } from '@/test/session';
import { ProfilePage } from './ProfilePage';

afterEach(() => vi.unstubAllGlobals());

it('loads the editor and connected sign-in methods, then saves changes through the API', async () => {
  const pending = deferred<Response>();
  const updateProfile = vi.fn();
  const profile = userProfile();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
    const path = new URL(String(url)).pathname;
    if (path === '/auth/providers')
      return Response.json({ google: { enabled: true, linked: true } });
    if (path === '/me/profile' && options?.method === 'GET') return pending.promise;
    if (path === '/me/profile' && options?.method === 'PATCH')
      return Response.json({ profile: { ...profile, bio: 'Updated bio', version: 2 } });
    throw new Error('Unexpected request: ' + path);
  });
  vi.stubGlobal('fetch', fetcher);
  const actor = userEvent.setup();
  render(
    <MemoryRouter>
      <TestSession auth={{ updateProfile }}>
        <ProfilePage />
      </TestSession>
    </MemoryRouter>,
  );
  expect(screen.getByText('Loading your profile…')).toBeVisible();
  expect(screen.getByRole('link', { name: /View public profile/ })).toHaveAttribute(
    'href',
    '/u/alex_morgan',
  );
  await act(async () => pending.resolve(Response.json({ profile })));
  expect(await screen.findByText('Google connected')).toBeVisible();
  await actor.clear(screen.getByLabelText(/Bio/));
  await actor.type(screen.getByLabelText(/Bio/), 'Updated bio');
  await actor.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Changes saved.')).toBeVisible();
  expect(updateProfile).toHaveBeenCalledWith(
    expect.objectContaining({ bio: 'Updated bio', version: 2 }),
  );
  const [, options] = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
  expect(JSON.parse(String(options!.body))).toMatchObject({
    bio: 'Updated bio',
    expectedVersion: 1,
  });
});

it('retries a failed profile load and cancels the current request on unmount', async () => {
  let attempts = 0;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (new URL(String(url)).pathname === '/auth/providers')
      return Response.json({ google: { enabled: false, linked: false } });
    if (++attempts === 1) throw new TypeError('offline');
    return Response.json({ profile: userProfile() });
  });
  vi.stubGlobal('fetch', fetcher);
  const actor = userEvent.setup();
  const view = render(
    <MemoryRouter>
      <TestSession>
        <ProfilePage />
      </TestSession>
    </MemoryRouter>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('We could not load your profile.');
  await actor.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByLabelText('Display name')).toHaveValue('Alex Morgan');
  const [, options] = fetcher.mock.calls
    .filter(([url]) => new URL(String(url)).pathname === '/me/profile')
    .at(-1)!;
  view.unmount();
  expect(options!.signal!.aborted).toBe(true);
});
