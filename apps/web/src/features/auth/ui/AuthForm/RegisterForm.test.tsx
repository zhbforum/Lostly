import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { deferred } from '@/test/deferred';
import { TestSession } from '@/test/session';
import { RegisterForm } from './RegisterForm';

const credentials = {
  displayName: 'Alex Morgan',
  email: 'alex@example.com',
  password: 'a long safe password',
};

function showForm(register = vi.fn()) {
  const actor = userEvent.setup();
  render(
    <TestSession auth={{ register }}>
      <RegisterForm />
    </TestSession>,
  );
  return { actor, register };
}

async function fillForm(actor: ReturnType<typeof userEvent.setup>) {
  await actor.type(screen.getByLabelText('Display name'), credentials.displayName);
  await actor.type(screen.getByLabelText('Email'), credentials.email);
  await actor.type(screen.getByLabelText('Password'), credentials.password);
}

it('focuses a linked error summary on invalid submission and clears errors as fields are corrected', async () => {
  const { actor, register } = showForm();

  await actor.click(screen.getByRole('button', { name: 'Create account' }));

  expect(document.activeElement).toHaveAttribute('aria-labelledby', 'form-error-summary-title');

  for (const label of ['Display name', 'Email', 'Password'])
    expect(screen.getByLabelText(label)).toBeInvalid();

  await actor.click(screen.getByRole('link', { name: 'Enter your display name.' }));

  expect(screen.getByLabelText('Display name')).toHaveFocus();
  expect(register).not.toHaveBeenCalled();

  await fillForm(actor);

  expect(screen.queryByRole('heading', { name: 'Check the form' })).not.toBeInTheDocument();

  await actor.click(screen.getByRole('button', { name: 'Create account' }));

  expect(register).toHaveBeenCalledExactlyOnceWith(credentials);
});

it('validates non-empty but invalid values before making a request', async () => {
  const { actor, register } = showForm();

  await actor.type(screen.getByLabelText('Display name'), 'A');
  await actor.type(screen.getByLabelText('Email'), 'not-an-email');
  await actor.type(screen.getByLabelText('Password'), 'short');
  await actor.click(screen.getByRole('button', { name: 'Create account' }));

  expect(screen.getByLabelText('Display name')).toHaveAccessibleDescription(
    'Display name must be at least 2 characters.',
  );
  expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
    'Enter an email address in the format name@example.com.',
  );
  expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
    /Use at least 15 characters/,
  );
  expect(register).not.toHaveBeenCalled();
});

it('prevents duplicate submissions and edits while registration is pending', async () => {
  const pending = deferred<void>();
  const { actor, register } = showForm(vi.fn().mockReturnValue(pending.promise));

  await fillForm(actor);
  await actor.click(screen.getByRole('button', { name: 'Create account' }));

  const submit = screen.getByRole('button', { name: 'Creating account…' });

  expect(submit).toBeDisabled();

  for (const label of ['Display name', 'Email', 'Password'])
    expect(screen.getByLabelText(label)).toBeDisabled();

  await actor.click(submit);

  expect(register).toHaveBeenCalledExactlyOnceWith(credentials);

  await act(async () => pending.resolve());

  expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
});

it('associates an existing-account response with email and permits a corrected retry', async () => {
  const register = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(409, 'EMAIL_TAKEN', 'Internal details'))
    .mockResolvedValueOnce(undefined);
  const { actor } = showForm(register);

  await fillForm(actor);
  await actor.click(screen.getByRole('button', { name: 'Create account' }));

  expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
    'An account with this email already exists.',
  );
  expect(document.activeElement).toHaveAttribute('aria-labelledby', 'form-error-summary-title');

  await actor.click(
    screen.getByRole('link', { name: 'An account with this email already exists.' }),
  );

  expect(screen.getByLabelText('Email')).toHaveFocus();

  await actor.clear(screen.getByLabelText('Email'));
  await actor.type(screen.getByLabelText('Email'), 'new@example.com');

  expect(screen.queryByRole('heading', { name: 'Check the form' })).not.toBeInTheDocument();

  await actor.click(screen.getByRole('button', { name: 'Create account' }));

  expect(register).toHaveBeenLastCalledWith({ ...credentials, email: 'new@example.com' });
  expect(register).toHaveBeenCalledTimes(2);
});

it.each([
  [
    new ApiError(429, 'RATE_LIMITED', 'Internal details'),
    'Too many registration attempts. Please wait a minute and try again.',
  ],
  [new TypeError('Network details'), 'Unable to create your account. Try again.'],
] as const)('shows a safe error and clears it when editing: %s', async (error, message) => {
  const { actor } = showForm(vi.fn().mockRejectedValue(error));

  await fillForm(actor);
  await actor.click(screen.getByRole('button', { name: 'Create account' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();

  await actor.type(screen.getByLabelText('Display name'), ' Jr');

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
