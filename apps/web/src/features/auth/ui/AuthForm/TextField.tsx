import type { ChangeEventHandler } from 'react';

import styles from '@/features/auth/ui/AuthForm/AuthForm.module.css';

interface TextFieldProps {
  id: string;
  name: string;
  label: string;
  type?: 'text' | 'email';
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  autoComplete?: string;
  error?: string | null;
  disabled?: boolean;
  autoCapitalize?: string;
  spellCheck?: boolean;
}

export function TextField({
  id,
  name,
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  error,
  disabled = false,
  autoCapitalize,
  spellCheck,
}: TextFieldProps) {
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>

      <input
        className={`${styles.input} ${error ? styles.inputError : ''}`}
        id={id}
        type={type}
        name={name}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        spellCheck={spellCheck}
        aria-required="true"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={errorId}
        disabled={disabled}
        value={value}
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
