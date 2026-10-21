import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/model/AuthProvider';
import type { AuthContextValue } from '@/features/auth/model/auth-context';
import { ConversationUnreadContext } from '@/features/conversations/model/use-conversation-unread';
import { deferred } from '@/test/deferred';
import { profileUser, userProfile } from '@/test/fixtures/profile';
import { TestSession } from '@/test/session';
import { AppRouter } from './AppRouter';

afterEach(() => vi.unstubAllGlobals());

function Position() {
  const { pathname, search, hash } = useLocation();
  return <output aria-label="Current URL">{pathname + search + hash}</output>;
}

function appAt(path: string, auth: Partial<AuthContextValue>) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <TestSession auth={auth}>
        <AppRouter />
        <Position />
      </TestSession>
    </MemoryRouter>
  );
}

it.each(['loading', 'error', 'unauthenticated'] as const)(
  'routes public profiles independently of the %s session state',
  async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ profile: userProfile() }));
    vi.stubGlobal('fetch', fetcher);

    render(appAt('/u/alex_morgan', { status, user: null }));

    expect(await screen.findByRole('heading', { name: 'Alex Morgan' })).toBeVisible();
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('/u/alex_morgan');
    expect(screen.queryByRole('heading', { name: 'Sign in to Lostly' })).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe('/u/alex_morgan');
  },
);

it('opens the current member profile from its account shortcut and edits it through the router', async () => {
  const actor = userEvent.setup();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/u/alex_morgan' || path === '/me/profile')
      return Response.json({ profile: userProfile() });
    if (path === '/auth/providers')
      return Response.json({ google: { enabled: false, linked: false } });
    throw new Error('Unexpected request: ' + path);
  });
  vi.stubGlobal('fetch', fetcher);

  render(appAt('/profile', {}));
  await actor.click(await screen.findByRole('link', { name: 'Edit profile' }));

  expect(await screen.findByLabelText('Display name')).toHaveValue('Alex Morgan');
  expect(screen.getByLabelText('Current URL')).toHaveTextContent('/profile/edit');
  expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toContain('/me/profile');
});

it('does not request private profile data until the session is authenticated', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (new URL(String(url)).pathname === '/auth/providers')
      return Response.json({ google: { enabled: false, linked: false } });
    return Response.json({ profile: userProfile() });
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(appAt('/profile/edit', { status: 'loading', user: null }));

  expect(screen.getByRole('heading', { name: 'Getting things ready' })).toBeVisible();
  expect(fetcher).not.toHaveBeenCalled();

  view.rerender(appAt('/profile/edit', { status: 'authenticated', user: profileUser() }));

  expect(await screen.findByLabelText('Display name')).toHaveValue('Alex Morgan');
});

it('keeps a session bootstrap failure distinct from being signed out on protected routes', () => {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);

  render(appAt('/profile/edit', { status: 'error', user: null }));

  expect(screen.getByRole('heading', { name: 'We could not load your session' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Current URL')).toHaveTextContent('/profile/edit');
  expect(fetcher).not.toHaveBeenCalled();
});

it('registers through the real auth provider and returns to the original private deep link', async () => {
  const actor = userEvent.setup();
  const pending = deferred<Response>();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/auth/me')
      return Response.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Sign in' } },
        { status: 401 },
      );
    if (path === '/auth/providers')
      return Response.json({ google: { enabled: false, linked: false } });
    if (path === '/auth/register') return pending.promise;
    if (path === '/listings')
      return Response.json({ listings: [], pageInfo: { endCursor: null, hasNextPage: false } });
    throw new Error('Unexpected request: ' + path);
  });
  vi.stubGlobal('fetch', fetcher);

  render(
    <MemoryRouter initialEntries={['/listings?kind=found#results']}>
      <AuthProvider>
        <ConversationUnreadContext.Provider
          value={{ unreadConversationCount: 0, refreshUnread: vi.fn() }}
        >
          <AppRouter />
          <Position />
        </ConversationUnreadContext.Provider>
      </AuthProvider>
    </MemoryRouter>,
  );
  await actor.click(await screen.findByRole('link', { name: 'Create an account' }));
  await actor.type(screen.getByLabelText('Display name'), 'Alex Morgan');
  await actor.type(screen.getByLabelText('Email'), 'alex@example.com');
  await actor.type(screen.getByLabelText('Password'), 'a long private password');
  await actor.click(screen.getByRole('button', { name: 'Create account' }));

  expect(screen.getByLabelText('Current URL')).toHaveTextContent('/register');
  expect(fetcher.mock.calls.some(([url]) => new URL(String(url)).pathname === '/listings')).toBe(
    false,
  );

  await act(async () => pending.resolve(Response.json({ user: profileUser() }, { status: 201 })));

  expect(await screen.findByRole('heading', { name: 'No matching active reports' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Account: Alex Morgan' })).toBeVisible();
  expect(screen.getByLabelText('Report type')).toHaveValue('found');
  await waitFor(() =>
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('/listings?kind=found#results'),
  );

  const requests = fetcher.mock.calls.filter(
    ([url]) => new URL(String(url)).pathname === '/auth/register',
  );

  expect(requests).toHaveLength(1);
  expect(JSON.parse(String(requests[0]![1]!.body))).toEqual({
    displayName: 'Alex Morgan',
    email: 'alex@example.com',
    password: 'a long private password',
  });
});
