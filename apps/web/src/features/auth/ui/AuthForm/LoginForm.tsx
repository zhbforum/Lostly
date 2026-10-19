import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/features/auth/model/auth-context';
import { getEmailError, getLoginPasswordError } from '@/features/auth/model/validation';
import { AuthAlert } from '@/features/auth/ui/AuthAlert/AuthAlert';
import styles from '@/features/auth/ui/AuthForm/AuthForm.module.css';
import { FormErrorSummary, type FormError } from '@/features/auth/ui/AuthForm/FormErrorSummary';
import { PasswordField } from '@/features/auth/ui/AuthForm/PasswordField';
import { TextField } from '@/features/auth/ui/AuthForm/TextField';
import { ApiError } from '@/shared/api/client';

interface LoginErrors {
  email: string | null;
  password: string | null;
}

const EMPTY_ERRORS: LoginErrors = {
  email: null,
  password: null,
};

export function LoginForm() {
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [errors, setErrors] = useState<LoginErrors>(EMPTY_ERRORS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [invalidSubmitCount, setInvalidSubmitCount] = useState(0);

  const errorSummaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (invalidSubmitCount > 0) {
      errorSummaryRef.current?.focus();
    }
  }, [invalidSubmitCount]);

  function handleEmailChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.currentTarget.value;

    setEmail(value);
    setErrorMessage(null);

    if (errors.email) {
      const emailError = getEmailError(value, event.currentTarget.validity.typeMismatch);
      setErrors((current) => ({
        ...current,
        email: emailError,
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
        password: getLoginPasswordError(value),
      }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setErrorMessage(null);

    const emailInput = event.currentTarget.elements.namedItem('email');

    const emailTypeMismatch =
      emailInput instanceof HTMLInputElement ? emailInput.validity.typeMismatch : false;

    const nextErrors: LoginErrors = {
      email: getEmailError(email, emailTypeMismatch),
      password: getLoginPasswordError(password),
    };

    setErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      setInvalidSubmitCount((count) => count + 1);
      return;
    }

    setIsSubmitting(true);

    try {
      await login({
        email,
        password,
      });
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError && error.code === 'INVALID_CREDENTIALS'
          ? 'Incorrect email or password.'
          : error instanceof ApiError && error.code === 'RATE_LIMITED'
            ? 'Too many sign-in attempts. Please wait a minute and try again.'
            : 'Unable to sign in. Try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const summaryErrors: FormError[] = [
    errors.email && {
      fieldId: 'login-email',
      message: errors.email,
    },
    errors.password && {
      fieldId: 'login-password',
      message: errors.password,
    },
  ].filter((error): error is FormError => Boolean(error));

  return (
    <form className={styles.form} noValidate aria-busy={isSubmitting} onSubmit={handleSubmit}>
      <FormErrorSummary ref={errorSummaryRef} errors={summaryErrors} />

      <TextField
        id="login-email"
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
        id="login-password"
        autoComplete="current-password"
        disabled={isSubmitting}
        error={errors.password}
        value={password}
        onChange={handlePasswordChange}
      />

      {errorMessage && <AuthAlert>{errorMessage}</AuthAlert>}

      <button className={styles.submit} type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
