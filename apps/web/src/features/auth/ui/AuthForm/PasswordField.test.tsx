import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { PasswordField } from './PasswordField';

it('toggles password visibility without changing its value or submitting the form', async () => {
  const submit = vi.fn((event) => event.preventDefault());
  function Form() {
    const [value, setValue] = useState('a private password');
    return (
      <form onSubmit={submit}>
        <PasswordField
          id="password"
          autoComplete="current-password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </form>
    );
  }
  const actor = userEvent.setup();
  render(<Form />);
  const input = screen.getByLabelText('Password');
  expect(input).toHaveAttribute('type', 'password');
  await actor.click(screen.getByRole('button', { name: 'Show password' }));
  expect(input).toHaveAttribute('type', 'text');
  expect(input).toHaveValue('a private password');
  expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await actor.click(screen.getByRole('button', { name: 'Hide password' }));
  expect(input).toHaveAttribute('type', 'password');
  expect(submit).not.toHaveBeenCalled();
});

it.each([
  [14, 'Minimum 15 characters'],
  [15, 'Password length met'],
  [128, 'Password length met'],
  [129, 'Use no more than 128 characters.'],
])('reports the length boundary at %s without truncating a pasted password', (length, feedback) => {
  render(
    <PasswordField
      id="password"
      value={'x'.repeat(length)}
      onChange={vi.fn()}
      autoComplete="new-password"
      minLength={15}
      maxLength={128}
    />,
  );
  expect(screen.getByLabelText('Password')).toHaveValue('x'.repeat(length));
  expect(screen.getByLabelText('Password')).not.toHaveAttribute('maxlength');
  expect(screen.getByText(feedback)).toHaveAttribute('aria-live', 'polite');
  expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
    'Use 15 to 128 characters.',
  );
});

it('disables the reveal control with the field and associates its error and hint', () => {
  render(
    <PasswordField
      id="password"
      value="short"
      onChange={vi.fn()}
      autoComplete="new-password"
      disabled
      error="Choose a longer password."
      hint="Pasting is supported."
    />,
  );
  expect(screen.getByLabelText('Password')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Show password' })).toBeDisabled();
  expect(screen.getByLabelText('Password')).toBeInvalid();
  expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
    /Choose a longer password.*Pasting is supported/,
  );
});
