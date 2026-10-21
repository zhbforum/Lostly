import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, parsePath, Route, Routes, useLocation } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '@/features/auth/model/auth-context';
import { deferred } from '@/test/deferred';
import { profileAvatar, userProfile } from '@/test/fixtures/profile';
import { TestSession } from '@/test/session';
import { PublicProfilePage } from './PublicProfilePage';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Position() {
  const { pathname, search, hash } = useLocation();
  return <output aria-label="Current URL">{pathname + search + hash}</output>;
}

function showProfile(
  path = '/u/alex_morgan',
  auth: Partial<AuthContextValue> = { status: 'unauthenticated', user: null },
  state?: { returnTo: string },
) {
  return render(
    <MemoryRouter initialEntries={[{ ...parsePath(path), state }]}>
      <TestSession auth={auth}>
        <Routes>
          <Route path="/u/:username" element={<PublicProfilePage />} />
          <Route path="/users/:id" element={<PublicProfilePage />} />
          <Route path="/" element={<h1>Home destination</h1>} />
        </Routes>
        <Position />
      </TestSession>
    </MemoryRouter>,
  );
}

it.each(['loading', 'unauthenticated', 'error'] as const)(
  'loads a public profile while session state is %s',
  async (status) => {
    const pending = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    vi.stubGlobal('fetch', fetcher);

    showProfile('/u/alex_morgan', { status, user: null });

    expect(screen.getByText('Loading profile…')).toBeVisible();

    if (status === 'loading')
      expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
    else expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');

    await act(async () => pending.resolve(Response.json({ profile: userProfile() })));

    expect(await screen.findByRole('heading', { name: 'Alex Morgan' })).toBeVisible();
    expect(screen.getByText('@alex_morgan')).toBeVisible();
    expect(screen.getByText(userProfile().bio)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Edit profile' })).not.toBeInTheDocument();
    expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe('/u/alex_morgan');
  },
);

it('canonicalizes an ID link while retaining its query, fragment and return destination', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ profile: userProfile({ bio: '' }) })),
  );

  showProfile('/users/alex?from=claim#member', {}, { returnTo: '/activity?tab=incoming' });

  await waitFor(() =>
    expect(screen.getByLabelText('Current URL')).toHaveTextContent(
      '/u/alex_morgan?from=claim#member',
    ),
  );
  expect(await screen.findByRole('link', { name: 'Edit profile' })).toHaveAttribute(
    'href',
    '/profile/edit',
  );
  expect(screen.getByRole('link', { name: /Back$/ })).toHaveAttribute(
    'href',
    '/activity?tab=incoming',
  );
  expect(screen.getByText(/A few words can help/)).toBeVisible();
});

it('keeps ID-based profiles without usernames accessible and shows an empty bio for another member', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ profile: userProfile({ username: null, bio: '' }) })),
  );

  showProfile('/users/alex');

  expect(await screen.findByRole('heading', { name: 'Alex Morgan' })).toBeVisible();
  expect(screen.getByText('This member hasn’t added a bio yet.')).toBeVisible();
  expect(screen.getByLabelText('Current URL')).toHaveTextContent('/users/alex');
});

it.each([404, 422])('shows not found for an unavailable profile (%s)', async (status) => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ error: { code: 'NOT_FOUND', message: 'Unavailable' } }, { status }),
      ),
  );

  showProfile();

  expect(await screen.findByRole('heading', { name: 'Profile not found' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Copy profile link' })).not.toBeInTheDocument();
});

it('recovers from a failed request after retry and aborts the request on unmount', async () => {
  const actor = userEvent.setup();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(Response.json({ profile: userProfile() }));
  vi.stubGlobal('fetch', fetcher);
  const view = showProfile();

  await actor.click(await screen.findByRole('button', { name: 'Try again' }));

  expect(await screen.findByRole('heading', { name: 'Alex Morgan' })).toBeVisible();
  expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);

  const signal = fetcher.mock.calls[1]![1]!.signal!;

  view.unmount();

  expect(signal.aborted).toBe(true);
});

it.each([false, true])(
  'reports clipboard success or failure without leaving the page (failure: %s)',
  async (fails) => {
    const actor = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, 'writeText');

    if (fails) copy.mockRejectedValue(new Error('denied'));
    else copy.mockResolvedValue();

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ profile: userProfile() })),
    );

    showProfile();
    await actor.click(await screen.findByRole('button', { name: 'Copy profile link' }));

    expect(copy).toHaveBeenCalledWith(new URL('/u/alex_morgan', window.location.origin).href);
    expect(
      await screen.findByText(
        fails
          ? 'Could not copy the link. You can copy it from your address bar.'
          : 'Profile link copied.',
      ),
    ).toBeVisible();
  },
);

it('plays an animated avatar only on request and rejects an external return destination', async () => {
  const actor = userEvent.setup();
  const avatar = profileAvatar();
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockResolvedValue(Response.json({ profile: userProfile({ avatar }) })),
  );

  showProfile('/u/alex_morgan', {}, { returnTo: 'https://outside.example' });

  const article = await screen.findByRole('article');

  expect(article.querySelector('img')).toHaveAttribute('src', avatar.staticUrl);

  await actor.click(screen.getByRole('button', { name: 'Play animation' }));

  expect(article.querySelector('img')).toHaveAttribute('src', avatar.url);
  expect(screen.getByRole('button', { name: 'Pause animation' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await actor.click(screen.getByRole('button', { name: 'Pause animation' }));

  expect(article.querySelector('img')).toHaveAttribute('src', avatar.staticUrl);
  expect(screen.getByRole('link', { name: /Back$/ })).toHaveAttribute('href', '/');
});
