import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginForm } from './LoginForm';

import { ApiError } from '@/shared/api/client';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
}));

vi.mock('@/features/auth/model/auth-context', () => ({
  useAuth: () => ({
    login: mocks.login,
  }),
}));

describe('LoginForm', () => {
  beforeEach(() => {
    mocks.login.mockReset();
  });

  it('shows validation errors and does not submit an empty form', async () => {
    const user = userEvent.setup();

    render(<LoginForm />);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const emailInput = screen.getByLabelText('Email');
    const passwordInput = screen.getByLabelText('Password');

    expect(emailInput).toBeInvalid();
    expect(emailInput).toHaveAccessibleDescription('Enter your email address.');

    expect(passwordInput).toBeInvalid();
    expect(passwordInput).toHaveAccessibleDescription('Enter your password.');

    expect(screen.getByRole('heading', { name: 'Check the form' })).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Enter your email address.' })).toHaveAttribute(
      'href',
      '#login-email',
    );

    expect(screen.getByRole('link', { name: 'Enter your password.' })).toHaveAttribute(
      'href',
      '#login-password',
    );

    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('moves focus to the error summary after an invalid submission', async () => {
    const user = userEvent.setup();

    render(<LoginForm />);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(document.activeElement).toHaveAttribute('aria-labelledby', 'form-error-summary-title');
  });

  it('moves focus to an invalid field from the error summary', async () => {
    const user = userEvent.setup();

    render(<LoginForm />);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await user.click(screen.getByRole('link', { name: 'Enter your email address.' }));

    expect(screen.getByLabelText('Email')).toHaveFocus();
  });

  it('submits valid credentials', async () => {
    const user = userEvent.setup();

    mocks.login.mockResolvedValue(undefined);

    render(<LoginForm />);

    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(mocks.login).toHaveBeenCalledOnce();
    expect(mocks.login).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'short',
    });
  });

  it('allows correcting email and password after an invalid submission', async () => {
    const user = userEvent.setup();

    mocks.login.mockResolvedValue(undefined);
    render(<LoginForm />);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.type(screen.getByLabelText('Password'), 'password');

    expect(screen.queryByRole('heading', { name: 'Check the form' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(mocks.login).toHaveBeenCalledExactlyOnceWith({
      email: 'user@example.com',
      password: 'password',
    });
  });

  it('disables submission while login is in progress', async () => {
    const user = userEvent.setup();

    let resolveLogin: (() => void) | undefined;

    mocks.login.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLogin = resolve;
        }),
    );

    render(<LoginForm />);

    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.type(screen.getByLabelText('Password'), 'password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();

    resolveLogin?.();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    });
  });

  it('shows a specific message when credentials are invalid', async () => {
    const user = userEvent.setup();

    mocks.login.mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials'));

    render(<LoginForm />);

    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.type(screen.getByLabelText('Password'), 'password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
  });

  it('shows a fallback message when login fails unexpectedly', async () => {
    const user = userEvent.setup();

    mocks.login.mockRejectedValue(new Error('Network failure'));

    render(<LoginForm />);

    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.type(screen.getByLabelText('Password'), 'password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Unable to sign in. Try again.')).toBeInTheDocument();
  });
});
