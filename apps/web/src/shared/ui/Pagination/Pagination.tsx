import type { PageInfo } from '@lostly/contracts/pagination';
import styles from './Pagination.module.css';

interface Props {
  pageInfo: PageInfo;
  hasPrevious: boolean;
  previousLabel?: string;
  onPrevious: () => void;
  onNext: (cursor: string) => void;
  disabled?: boolean;
  label?: string;
}

export function Pagination({
  pageInfo,
  hasPrevious,
  previousLabel = 'Previous',
  onPrevious,
  onNext,
  disabled,
  label = 'Pages',
}: Props) {
  if (!hasPrevious && !pageInfo.hasNextPage) return null;
  return (
    <nav className={styles.pagination} aria-label={label}>
      <button type="button" disabled={disabled || !hasPrevious} onClick={onPrevious}>
        {previousLabel}
      </button>
      <button
        type="button"
        disabled={disabled || !pageInfo.hasNextPage || !pageInfo.endCursor}
        onClick={() => {
          if (pageInfo.endCursor) onNext(pageInfo.endCursor);
        }}
      >
        Next
      </button>
    </nav>
  );
}
