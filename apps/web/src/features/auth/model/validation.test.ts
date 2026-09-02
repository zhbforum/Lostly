import { describe, expect, it } from 'vitest';

import {
  AUTH_CONSTRAINTS,
  getDisplayNameError,
  getEmailError,
  getLoginPasswordError,
  getNewPasswordError,
} from './validation';

describe('getDisplayNameError', () => {
  it('requires a display name', () => {
    expect(getDisplayNameError('')).toBe('Enter your display name.');
    expect(getDisplayNameError('   ')).toBe('Enter your display name.');
  });

  it('rejects a display name shorter than the minimum length', () => {
    expect(getDisplayNameError('a')).toBe(
      `Display name must be at least ${AUTH_CONSTRAINTS.displayNameMinLength} characters.`,
    );
  });

  it('accepts a display name at the minimum length', () => {
    expect(getDisplayNameError('ab')).toBeNull();
  });

  it('trims surrounding whitespace before validating the length', () => {
    expect(getDisplayNameError('  ab  ')).toBeNull();
  });

  it('accepts a display name at the maximum length', () => {
    expect(getDisplayNameError('a'.repeat(AUTH_CONSTRAINTS.displayNameMaxLength))).toBeNull();
  });

  it('rejects a display name longer than the maximum length', () => {
    expect(getDisplayNameError('a'.repeat(AUTH_CONSTRAINTS.displayNameMaxLength + 1))).toBe(
      `Display name must be ${AUTH_CONSTRAINTS.displayNameMaxLength} characters or fewer.`,
    );
  });
});

describe('getEmailError', () => {
  it('requires an email address', () => {
    expect(getEmailError('', false)).toBe('Enter your email address.');
    expect(getEmailError('   ', false)).toBe('Enter your email address.');
  });

  it('accepts an email address at the maximum length', () => {
    expect(getEmailError('a'.repeat(AUTH_CONSTRAINTS.emailMaxLength), false)).toBeNull();
  });

  it('rejects an email address longer than the maximum length', () => {
    expect(getEmailError('a'.repeat(AUTH_CONSTRAINTS.emailMaxLength + 1), false)).toBe(
      `Email address must be ${AUTH_CONSTRAINTS.emailMaxLength} characters or fewer.`,
    );
  });

  it('rejects an email address when the browser reports a type mismatch', () => {
    expect(getEmailError('invalid-email', true)).toBe(
      'Enter an email address in the format name@example.com.',
    );
  });

  it('accepts a non-empty email address without a type mismatch', () => {
    expect(getEmailError('user@example.com', false)).toBeNull();
  });
});

describe('getLoginPasswordError', () => {
  it('requires a password', () => {
    expect(getLoginPasswordError('')).toBe('Enter your password.');
  });

  it('does not enforce the new-password minimum length', () => {
    expect(getLoginPasswordError('short')).toBeNull();
  });

  it('accepts a password at the maximum length', () => {
    expect(getLoginPasswordError('a'.repeat(AUTH_CONSTRAINTS.passwordMaxLength))).toBeNull();
  });

  it('rejects a password longer than the maximum length', () => {
    expect(getLoginPasswordError('a'.repeat(AUTH_CONSTRAINTS.passwordMaxLength + 1))).toBe(
      `Use no more than ${AUTH_CONSTRAINTS.passwordMaxLength} characters for your password.`,
    );
  });
});

describe('getNewPasswordError', () => {
  it('requires a password', () => {
    expect(getNewPasswordError('')).toBe('Enter your password.');
  });

  it('rejects a password shorter than the minimum length', () => {
    expect(getNewPasswordError('a'.repeat(AUTH_CONSTRAINTS.newPasswordMinLength - 1))).toBe(
      `Use at least ${AUTH_CONSTRAINTS.newPasswordMinLength} characters for your password.`,
    );
  });

  it('accepts a password at the minimum length', () => {
    expect(getNewPasswordError('a'.repeat(AUTH_CONSTRAINTS.newPasswordMinLength))).toBeNull();
  });

  it('accepts a password at the maximum length', () => {
    expect(getNewPasswordError('a'.repeat(AUTH_CONSTRAINTS.passwordMaxLength))).toBeNull();
  });

  it('rejects a password longer than the maximum length', () => {
    expect(getNewPasswordError('a'.repeat(AUTH_CONSTRAINTS.passwordMaxLength + 1))).toBe(
      `Use no more than ${AUTH_CONSTRAINTS.passwordMaxLength} characters for your password.`,
    );
  });
});
