import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as ReactDOMClient from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { profileUser } from '@/test/fixtures/profile';

vi.mock('react-dom/client', { spy: true });

let root: ReactDOMClient.Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('boots with the real providers, restores a filtered route and signs out', async () => {
  window.history.replaceState(null, '', '/listings?kind=found');
  container = document.createElement('div');
  container.id = 'root';
  document.body.append(container);
  const mount = vi.mocked(ReactDOMClient.createRoot);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/auth/me') return Response.json({ user: profileUser() });
    if (path === '/listings')
      return Response.json({ listings: [], pageInfo: { endCursor: null, hasNextPage: false } });
    if (path === '/me/conversations/unread-count')
      return Response.json({ unreadConversationCount: 2 });
    if (path === '/auth/logout') return new Response(null, { status: 204 });
    if (path === '/auth/providers')
      return Response.json({ google: { enabled: false, linked: false } });
    throw new Error('Unexpected request: ' + path);
  });
  vi.stubGlobal('fetch', fetcher);
  const actor = userEvent.setup();
  await act(async () => {
    await import('./main');
    root = mount.mock.results[0]!.value;
  });
  expect(await screen.findByRole('heading', { name: 'No matching active reports' })).toBeVisible();
  expect(screen.getByLabelText('Report type')).toHaveValue('found');
  expect(screen.getByRole('link', { name: 'Browse' })).toHaveAttribute('aria-current', 'page');
  expect(
    await screen.findByRole('link', { name: 'Messages, 2 unread conversations' }),
  ).toHaveAttribute('href', '/messages');
  await actor.selectOptions(screen.getByLabelText('Report type'), 'lost');
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('kind')).toBe('lost'));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(([url]) => {
        const request = new URL(String(url));
        return request.pathname === '/listings' && request.searchParams.get('kind') === 'lost';
      }),
    ).toBe(true),
  );
  await actor.click(screen.getByRole('button', { name: 'Account: Alex Morgan' }));
  await actor.click(await screen.findByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(window.location.pathname).toBe('/login');
  expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
  const [, logout] = fetcher.mock.calls.find(
    ([url]) => new URL(String(url)).pathname === '/auth/logout',
  )!;
  expect(logout).toMatchObject({ method: 'POST', credentials: 'include' });
});
