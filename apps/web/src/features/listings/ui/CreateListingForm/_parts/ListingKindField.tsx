import type { ListingKind } from '@/features/listings/model/types';
import fieldStyles from '@/features/listings/ui/ListingFormFields/ListingField.module.css';
import styles from './ListingKindField.module.css';

interface ListingKindFieldProps {
  name: string;
  value: ListingKind | null;
  error: string | null;
  disabled?: boolean;
  onChange: (value: ListingKind) => void;
}

const OPTIONS: ReadonlyArray<{
  value: ListingKind;
  title: string;
  description: string;
}> = [
  {
    value: 'lost',
    title: 'I lost something',
    description: 'Create a report so others can help recognize and return it.',
  },
  {
    value: 'found',
    title: 'I found something',
    description: 'Share what you found without revealing private ownership details.',
  },
];

export function ListingKindField({
  name,
  value,
  error,
  disabled = false,
  onChange,
}: ListingKindFieldProps) {
  const hintId = `${name}-hint`;
  const errorId = error ? `${name}-error` : undefined;

  const describedBy = [hintId, errorId].filter(Boolean).join(' ');

  return (
    <fieldset className={styles.kindFieldset} aria-describedby={describedBy}>
      <legend className={styles.sectionLegend}>What happened?</legend>

      <p className={styles.sectionHint} id={hintId}>
        Select the option that best describes your report.
      </p>

      <div className={styles.kindOptions}>
        {OPTIONS.map((option) => {
          const id = `${name}-${option.value}`;
          const selected = value === option.value;

          return (
            <div className={styles.kindOption} key={option.value}>
              <input
                className={styles.kindRadio}
                id={id}
                name={name}
                type="radio"
                value={option.value}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(option.value)}
              />

              <label
                className={`${styles.kindCard} ${selected ? styles.kindCardSelected : ''}`}
                htmlFor={id}
              >
                <span className={styles.kindIndicator} aria-hidden="true">
                  <span className={styles.kindIndicatorDot} />
                </span>

                <span className={styles.kindContent}>
                  <span className={styles.kindTitle}>{option.title}</span>
                  <span className={styles.kindDescription}>{option.description}</span>
                </span>
              </label>
            </div>
          );
        })}
      </div>

      {error && (
        <p className={fieldStyles.fieldError} id={errorId}>
          <span className={fieldStyles.errorIcon} aria-hidden="true">
            !
          </span>
          {error}
        </p>
      )}
    </fieldset>
  );
}
