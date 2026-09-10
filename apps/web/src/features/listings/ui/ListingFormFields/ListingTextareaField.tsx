import type { ChangeEventHandler } from 'react';

import { ListingCharacterCount } from './ListingCharacterCount';
import styles from './ListingField.module.css';
import { CHARACTER_COUNT_THRESHOLD } from './character-count.constants';

interface ListingTextareaFieldProps {
  id: string;
  name: string;
  label: string;
  hint?: string;
  error: string | null;
  value: string;
  maxLength: number;
  disabled?: boolean;
  rows?: number;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
}

export function ListingTextareaField({
  id,
  name,
  label,
  hint,
  error,
  value,
  maxLength,
  disabled = false,
  rows = 6,
  onChange,
}: ListingTextareaFieldProps) {
  const currentLength = value.trim().length;

  const hintId = hint ? `${id}-hint` : undefined;
  const countId =
    currentLength >= maxLength * CHARACTER_COUNT_THRESHOLD ? `${id}-character-count` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  const describedBy = [hintId, countId, errorId].filter(Boolean).join(' ') || undefined;

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

      <textarea
        className={`${styles.textarea} ${error ? styles.inputError : ''}`}
        id={id}
        name={name}
        value={value}
        rows={rows}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={onChange}
      />

      <ListingCharacterCount
        id={`${id}-character-count`}
        currentLength={currentLength}
        maxLength={maxLength}
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
