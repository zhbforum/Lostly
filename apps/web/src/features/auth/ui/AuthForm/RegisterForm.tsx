import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/features/auth/model/auth-context';
import {
  AUTH_CONSTRAINTS,
  getDisplayNameError,
  getEmailError,
  getNewPasswordError,
} from '@/features/auth/model/validation';
import { AuthAlert } from '@/features/auth/ui/AuthAlert/AuthAlert';
import styles from '@/features/auth/ui/AuthForm/AuthForm.module.css';
import { FormErrorSummary, type FormError } from '@/features/auth/ui/AuthForm/FormErrorSummary';
import { PasswordField } from '@/features/auth/ui/AuthForm/PasswordField';
import { TextField } from '@/features/auth/ui/AuthForm/TextField';
import { ApiError } from '@/shared/api/client';

interface RegisterErrors {
  displayName: string | null;
  email: string | null;
  password: string | null;
}

const EMPTY_ERRORS: RegisterErrors = {
  displayName: null,
  email: null,
  password: null,
};

export function RegisterForm() {
  const { register } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [errors, setErrors] = useState<RegisterErrors>(EMPTY_ERRORS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [invalidSubmitCount, setInvalidSubmitCount] = useState(0);

  const errorSummaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (invalidSubmitCount > 0) {
      errorSummaryRef.current?.focus();
    }
  }, [invalidSubmitCount]);

  function handleDisplayNameChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.currentTarget.value;

    setDisplayName(value);
    setErrorMessage(null);

    if (errors.displayName) {
      setErrors((current) => ({
        ...current,
        displayName: getDisplayNameError(value),
      }));
    }
  }

  function handleEmailChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.currentTarget.value;

    setEmail(value);
    setErrorMessage(null);

    if (errors.email) {
      setErrors((current) => ({
        ...current,
        email: getEmailError(value, event.currentTarget.validity.typeMismatch),
      }));
    }
  }

  function handlePasswordChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.currentTarget.value;

    setPassword(value);
    setErrorMessage(null);

    if (errors.password) {
      setErrors((current) => ({
        ...current,
        password: getNewPasswordError(value),
      }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setErrorMessage(null);

    const emailInput = event.currentTarget.elements.namedItem('email');

    const emailTypeMismatch =
      emailInput instanceof HTMLInputElement ? emailInput.validity.typeMismatch : false;

    const nextErrors: RegisterErrors = {
      displayName: getDisplayNameError(displayName),
      email: getEmailError(email, emailTypeMismatch),
      password: getNewPasswordError(password),
    };

    setErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      setInvalidSubmitCount((count) => count + 1);
      return;
    }

    setIsSubmitting(true);

    try {
      await register({
        displayName,
        email,
        password,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'RATE_LIMITED') {
        setErrorMessage('Too many registration attempts. Please wait a minute and try again.');
        return;
      }
      if (error instanceof ApiError && error.code === 'EMAIL_TAKEN') {
        setErrors((current) => ({
          ...current,
          email: 'An account with this email already exists.',
        }));
        setInvalidSubmitCount((count) => count + 1);
        return;
      }

      setErrorMessage('Unable to create your account. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const summaryErrors: FormError[] = [
    errors.displayName && {
      fieldId: 'register-display-name',
      message: errors.displayName,
    },
    errors.email && {
      fieldId: 'register-email',
      message: errors.email,
    },
    errors.password && {
      fieldId: 'register-password',
      message: errors.password,
    },
  ].filter((error): error is FormError => Boolean(error));

  return (
    <form className={styles.form} noValidate aria-busy={isSubmitting} onSubmit={handleSubmit}>
      <FormErrorSummary ref={errorSummaryRef} errors={summaryErrors} />

      <TextField
        id="register-display-name"
        name="displayName"
        label="Display name"
        autoComplete="name"
        disabled={isSubmitting}
        error={errors.displayName}
        value={displayName}
        onChange={handleDisplayNameChange}
      />

      <TextField
        id="register-email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        disabled={isSubmitting}
        error={errors.email}
        value={email}
        onChange={handleEmailChange}
      />

      <PasswordField
        id="register-password"
        autoComplete="new-password"
        minLength={AUTH_CONSTRAINTS.newPasswordMinLength}
        maxLength={AUTH_CONSTRAINTS.passwordMaxLength}
        hint="Password managers and pasted passwords are supported."
        error={errors.password}
        disabled={isSubmitting}
        value={password}
        onChange={handlePasswordChange}
      />

      {errorMessage && <AuthAlert>{errorMessage}</AuthAlert>}

      <button className={styles.submit} type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
