export const AUTH_CONSTRAINTS = {
  emailMaxLength: 254,
  displayNameMinLength: 2,
  displayNameMaxLength: 80,
  newPasswordMinLength: 15,
  passwordMaxLength: 128,
} as const;

export function getDisplayNameError(value: string): string | null {
  const displayName = value.trim();

  if (!displayName) {
    return 'Enter your display name.';
  }

  if (displayName.length < AUTH_CONSTRAINTS.displayNameMinLength) {
    return `Display name must be at least ${AUTH_CONSTRAINTS.displayNameMinLength} characters.`;
  }

  if (displayName.length > AUTH_CONSTRAINTS.displayNameMaxLength) {
    return `Display name must be ${AUTH_CONSTRAINTS.displayNameMaxLength} characters or fewer.`;
  }

  return null;
}

export function getEmailError(value: string, typeMismatch: boolean): string | null {
  const email = value.trim();

  if (!email) {
    return 'Enter your email address.';
  }

  if (email.length > AUTH_CONSTRAINTS.emailMaxLength) {
    return `Email address must be ${AUTH_CONSTRAINTS.emailMaxLength} characters or fewer.`;
  }

  if (typeMismatch) {
    return 'Enter an email address in the format name@example.com.';
  }

  return null;
}

export function getLoginPasswordError(value: string): string | null {
  if (!value) {
    return 'Enter your password.';
  }

  return getPasswordMaxLengthError(value);
}

export function getNewPasswordError(value: string): string | null {
  if (!value) {
    return 'Enter your password.';
  }

  if (value.length < AUTH_CONSTRAINTS.newPasswordMinLength) {
    return `Use at least ${AUTH_CONSTRAINTS.newPasswordMinLength} characters for your password.`;
  }

  return getPasswordMaxLengthError(value);
}

function getPasswordMaxLengthError(value: string): string | null {
  if (value.length > AUTH_CONSTRAINTS.passwordMaxLength) {
    return `Use no more than ${AUTH_CONSTRAINTS.passwordMaxLength} characters for your password.`;
  }

  return null;
}
