import { forwardRef } from 'react';

import styles from '@/features/auth/ui/AuthForm/AuthForm.module.css';

export interface FormError {
  fieldId: string;
  message: string;
}

interface FormErrorSummaryProps {
  errors: FormError[];
}

export const FormErrorSummary = forwardRef<HTMLDivElement, FormErrorSummaryProps>(
  function FormErrorSummary({ errors }, ref) {
    if (errors.length === 0) {
      return null;
    }

    function focusField(fieldId: string) {
      document.getElementById(fieldId)?.focus();
    }

    return (
      <div
        className={styles.errorSummary}
        ref={ref}
        tabIndex={-1}
        aria-labelledby="form-error-summary-title"
      >
        <h2 className={styles.errorSummaryTitle} id="form-error-summary-title">
          Check the form
        </h2>

        <ul className={styles.errorSummaryList}>
          {errors.map((error) => (
            <li key={error.fieldId}>
              <a
                className={styles.errorSummaryLink}
                href={`#${error.fieldId}`}
                onClick={(event) => {
                  event.preventDefault();
                  focusField(error.fieldId);
                }}
              >
                {error.message}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  },
);
