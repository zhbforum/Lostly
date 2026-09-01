import type { ChangeEventHandler } from 'react';
import { useState } from 'react';

import styles from '@/features/auth/ui/AuthForm/AuthForm.module.css';

type PasswordAutocomplete = 'current-password' | 'new-password';
type PasswordLengthState = 'tooShort' | 'valid' | 'tooLong';

interface PasswordFieldProps {
  id: string;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  autoComplete: PasswordAutocomplete;
  hint?: string;
  minLength?: number;
  maxLength?: number;
  error?: string | null;
  disabled?: boolean;
}

export function PasswordField({
  id,
  value,
  onChange,
  autoComplete,
  hint,
  minLength,
  maxLength,
  error,
  disabled = false,
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);

  const lengthRequirement =
    minLength === undefined || maxLength === undefined ? undefined : { minLength, maxLength };
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const requirementId = lengthRequirement ? `${id}-requirement` : undefined;

  const describedBy = [errorId, requirementId, hintId].filter(Boolean).join(' ') || undefined;

  const lengthState = lengthRequirement
    ? getPasswordLengthState(value.length, lengthRequirement.minLength, lengthRequirement.maxLength)
    : undefined;
  const statusText =
    lengthState === undefined || !lengthRequirement
      ? undefined
      : getPasswordLengthStatusText(
          lengthState,
          lengthRequirement.minLength,
          lengthRequirement.maxLength,
        );
  const progress = lengthRequirement
    ? Math.min((value.length / lengthRequirement.minLength) * 100, 100)
    : 100;
  const progressStateClass =
    lengthState === 'valid'
      ? styles.requirementProgressComplete
      : lengthState === 'tooLong'
        ? styles.requirementProgressError
        : '';

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        Password
      </label>

      <div className={styles.passwordControl}>
        <input
          className={`${styles.input} ${styles.passwordInput} ${error ? styles.inputError : ''}`}
          id={id}
          type={isVisible ? 'text' : 'password'}
          name="password"
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          minLength={minLength}
          aria-required="true"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          value={value}
          onChange={onChange}
        />

        <button
          className={styles.passwordToggle}
          type="button"
          aria-controls={id}
          aria-label={isVisible ? 'Hide password' : 'Show password'}
          aria-pressed={isVisible}
          disabled={disabled}
          onClick={() => setIsVisible((visible) => !visible)}
        >
          {isVisible ? 'Hide' : 'Show'}
        </button>
      </div>

      {error && (
        <p className={styles.fieldError} id={errorId}>
          <span className={styles.errorIcon} aria-hidden="true">
            !
          </span>
          {error}
        </p>
      )}

      {lengthRequirement && lengthState !== undefined && statusText !== undefined && (
        <div className={styles.requirement}>
          <p className={styles.visuallyHidden} id={requirementId}>
            Use {lengthRequirement.minLength} to {lengthRequirement.maxLength} characters.
          </p>

          <div className={styles.requirementText}>
            <span
              className={lengthState === 'tooLong' ? styles.requirementStatusError : undefined}
              aria-live="polite"
            >
              {statusText}
            </span>

            <span aria-hidden="true">
              {value.length}
              {' / '}
              {lengthRequirement.maxLength}
            </span>
          </div>

          <div className={styles.requirementTrack} aria-hidden="true">
            <div
              className={`${styles.requirementProgress} ${progressStateClass}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {hint && (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

function getPasswordLengthState(
  length: number,
  minLength: number,
  maxLength: number,
): PasswordLengthState {
  if (length < minLength) {
    return 'tooShort';
  }

  if (length > maxLength) {
    return 'tooLong';
  }

  return 'valid';
}

function getPasswordLengthStatusText(
  state: PasswordLengthState,
  minLength: number,
  maxLength: number,
): string {
  switch (state) {
    case 'tooShort':
      return `Minimum ${minLength} characters`;
    case 'valid':
      return 'Password length met';
    case 'tooLong':
      return `Use no more than ${maxLength} characters.`;
  }
}
