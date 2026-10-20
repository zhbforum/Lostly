import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { expect, it, vi } from 'vitest';
import { deferred } from '@/test/deferred';
import { TestSession } from '@/test/session';
import { AccountMenu } from './AccountMenu';

it('does not expose an account menu without an authenticated user', () => {
  render(
    <TestSession auth={{ user: null, status: 'unauthenticated' }}>
      <AccountMenu />
    </TestSession>,
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('opens by keyboard, displays the identity and closes on profile navigation', async () => {
  const actor = userEvent.setup();
  render(
    <MemoryRouter>
      <TestSession>
        <AccountMenu />
        <Routes>
          <Route path="/profile" element={<h1>Public profile</h1>} />
          <Route path="/" element={null} />
        </Routes>
      </TestSession>
    </MemoryRouter>,
  );
  await actor.tab();
  expect(screen.getByRole('button', { name: 'Account: Alex Morgan' })).toHaveFocus();
  await actor.keyboard('{Enter}');
  expect(await screen.findByRole('dialog', { name: 'Your account' })).toBeVisible();
  expect(screen.getByText('alex@example.com')).toBeVisible();
  await actor.click(screen.getByRole('link', { name: 'Profile' }));
  expect(await screen.findByRole('heading', { name: 'Public profile' })).toBeVisible();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('blocks duplicate logout attempts and permits retry after a failure', async () => {
  const actor = userEvent.setup();
  const pending = deferred<void>();
  const logout = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(undefined);
  const view = render(
    <MemoryRouter>
      <TestSession auth={{ logout }}>
        <AccountMenu />
      </TestSession>
    </MemoryRouter>,
  );
  await actor.click(screen.getByRole('button', { name: 'Account: Alex Morgan' }));
  await actor.click(await screen.findByRole('button', { name: 'Sign out' }));
  await actor.click(screen.getByRole('button', { name: 'Signing out…' }));
  expect(logout).toHaveBeenCalledOnce();
  await act(async () => pending.reject(new Error('Network failed')));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Unable to sign out. Please try again.',
  );
  await actor.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(logout).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  view.rerender(
    <MemoryRouter>
      <TestSession auth={{ user: null, status: 'unauthenticated', logout }}>
        <AccountMenu />
      </TestSession>
    </MemoryRouter>,
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
