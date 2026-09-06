import { useId, type Ref } from 'react';

import styles from './ListingFormErrorSummary.module.css';

export interface ListingFormError {
  fieldId: string;
  message: string;
}

interface ListingFormErrorSummaryProps {
  errors: ListingFormError[];
  ref?: Ref<HTMLDivElement>;
  onFocusField: (fieldId: string) => void;
}

export function ListingFormErrorSummary({
  errors,
  ref,
  onFocusField,
}: ListingFormErrorSummaryProps) {
  const titleId = useId();
  if (errors.length === 0) {
    return null;
  }

  return (
    <div className={styles.errorSummary} ref={ref} tabIndex={-1} aria-labelledby={titleId}>
      <h2 className={styles.errorSummaryTitle} id={titleId}>
        Check your report
      </h2>

      <p className={styles.errorSummaryDescription}>Fix the following fields to continue.</p>

      <ul className={styles.errorSummaryList}>
        {errors.map((error) => (
          <li key={error.fieldId}>
            <a
              className={styles.errorSummaryLink}
              href={`#${error.fieldId}`}
              onClick={(event) => {
                event.preventDefault();
                onFocusField(error.fieldId);
              }}
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
