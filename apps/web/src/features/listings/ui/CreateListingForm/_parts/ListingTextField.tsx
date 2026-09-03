import type { ChangeEventHandler } from 'react';

import styles from './ListingField.module.css';

interface ListingTextFieldProps {
  id: string;
  name: string;
  label: string;
  hint?: string;
  error: string | null;
  value: string;
  maxLength?: number;
  autoComplete?: string;
  disabled?: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
}

export function ListingTextField({
  id,
  name,
  label,
  hint,
  error,
  value,
  maxLength,
  autoComplete,
  disabled = false,
  onChange,
}: ListingTextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>

      {hint && (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      )}

      <input
        className={`${styles.input} ${error ? styles.inputError : ''}`}
        id={id}
        name={name}
        type="text"
        value={value}
        maxLength={maxLength}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={onChange}
      />

      {error && (
        <p className={styles.fieldError} id={errorId}>
          <span className={styles.errorIcon} aria-hidden="true">
            !
          </span>
          {error}
        </p>
      )}
    </div>
  );
}
