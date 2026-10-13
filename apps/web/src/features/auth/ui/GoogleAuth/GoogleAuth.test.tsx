import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getAuthProviders, startGoogleAuth } from '@/features/auth/api/auth-api';
import { GoogleAuth } from './GoogleAuth';

vi.mock('@/features/auth/api/auth-api', () => ({
  getAuthProviders: vi.fn(),
  startGoogleAuth: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(getAuthProviders).mockResolvedValue({ google: { enabled: true, linked: false } });
  window.history.replaceState(null, '', '/login');
});
afterEach(() => vi.resetAllMocks());
it('hides Google when it is not configured', async () => {
  vi.mocked(getAuthProviders).mockResolvedValue({ google: { enabled: false, linked: false } });
  await act(async () => {
    render(<GoogleAuth />);
  });
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('starts with the requested destination and reports failure without submitting credentials', async () => {
  vi.mocked(startGoogleAuth).mockRejectedValue(new Error('offline'));
  render(<GoogleAuth returnTo="/listings/example#claims" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
  await waitFor(() =>
    expect(startGoogleAuth).toHaveBeenCalledWith('login', '/listings/example#claims'),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  expect(screen.getByRole('button')).toBeEnabled();
});
it('requires backend confirmation to show Google connected', async () => {
  window.history.replaceState(null, '', '/?google=linked');
  render(<GoogleAuth mode="link" />);
  expect(await screen.findByRole('button', { name: 'Connect Google' })).toBeInTheDocument();
});
it('shows connected state and no link button for a linked account', async () => {
  vi.mocked(getAuthProviders).mockResolvedValue({ google: { enabled: true, linked: true } });
  render(<GoogleAuth mode="link" />);
  expect(await screen.findByRole('status')).toHaveTextContent('Google connected');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('explains the password-first path for an existing account', () => {
  window.history.replaceState(null, '', '/login?google=account_exists');
  render(<GoogleAuth />);
  expect(screen.getByRole('alert')).toHaveTextContent('Use your password');
});

it.each(['__proto__', 'constructor', 'toString', 'unknown'])(
  'ignores unrecognized callback result %s',
  async (result) => {
    window.history.replaceState(null, '', '/login?google=' + result);
    render(<GoogleAuth />);
    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  },
);
