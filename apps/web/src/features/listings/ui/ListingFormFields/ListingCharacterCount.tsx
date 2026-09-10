import styles from './ListingField.module.css';
import { CHARACTER_COUNT_THRESHOLD } from './character-count.constants';

interface ListingCharacterCountProps {
  id: string;
  currentLength: number;
  maxLength: number;
}

export function ListingCharacterCount({
  id,
  currentLength,
  maxLength,
}: ListingCharacterCountProps) {
  const remaining = maxLength - currentLength;
  const shouldShow = currentLength >= maxLength * CHARACTER_COUNT_THRESHOLD;

  if (!shouldShow) {
    return null;
  }

  const isOverLimit = remaining < 0;
  const absoluteRemaining = Math.abs(remaining);

  return (
    <p
      className={`${styles.characterCount} ${isOverLimit ? styles.characterCountError : ''}`}
      id={id}
      aria-live="polite"
    >
      {isOverLimit
        ? `${absoluteRemaining} ${absoluteRemaining === 1 ? 'character' : 'characters'} over the limit`
        : `${remaining} ${remaining === 1 ? 'character' : 'characters'} remaining`}
    </p>
  );
}
