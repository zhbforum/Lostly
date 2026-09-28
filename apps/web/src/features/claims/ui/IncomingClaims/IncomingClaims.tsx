import { useCallback } from 'react';
import { getIncomingClaims } from '@/features/claims/api/claims-api';
import { useClaimDecision } from '@/features/claims/model/use-claim-decision';
import { IncomingClaimCard } from './IncomingClaimCard';
import { useApiResource } from '@/shared/model/use-api-resource';
import { useCursorNavigation } from '@/shared/model/use-cursor-navigation';
import { Pagination } from '@/shared/ui/Pagination/Pagination';
import styles from './IncomingClaims.module.css';

interface Props {
  listingId: string;
  onChanged: () => void;
}

export function IncomingClaims({ listingId, onChanged }: Props) {
  const navigation = useCursorNavigation('claimsCursor');
  const { cursor } = navigation;
  const fetcher = useCallback(
    (signal: AbortSignal) => getIncomingClaims(listingId, signal, cursor),
    [listingId, cursor],
  );
  const { state, refresh } = useApiResource(JSON.stringify([listingId, cursor]), fetcher);
  const decision = useClaimDecision(onChanged);

  return (
    <section className={styles.panel} aria-labelledby="incoming-claims-heading">
      <header className={styles.header}>
        <p className={styles.eyebrow}>Owner workspace</p>
        <h2 id="incoming-claims-heading">Incoming claims</h2>
        <p>
          Review the private proof before deciding. Approval closes the report and rejects other
          pending claims.
        </p>
      </header>
      {state.status === 'loading' && (
        <p className={styles.status} role="status">
          Loading claims…
        </p>
      )}
      {state.status === 'error' && (
        <div className={styles.error} role="alert">
          <p>We could not load incoming claims.</p>
          <button type="button" onClick={refresh}>
            Try again
          </button>
          {navigation.hasPrevious && (
            <button type="button" onClick={navigation.reset}>
              First page
            </button>
          )}
        </div>
      )}
      {state.status === 'success' && (
        <>
          {state.data.claims.length === 0 ? (
            <p className={styles.status}>No claims on this page.</p>
          ) : (
            <ul className={styles.claims}>
              {state.data.claims.map((claim) => (
                <IncomingClaimCard
                  key={claim.id}
                  claim={claim}
                  disabled={decision.pendingId !== null}
                  isUpdating={decision.pendingId === claim.id}
                  onDecision={decision.submit}
                  error={decision.error}
                  clearError={decision.clearError}
                  onRefresh={onChanged}
                />
              ))}
            </ul>
          )}
          <Pagination
            pageInfo={state.data.pageInfo}
            hasPrevious={navigation.hasPrevious}
            previousLabel={navigation.previousLabel}
            onPrevious={navigation.previous}
            onNext={navigation.next}
            disabled={decision.pendingId !== null}
            label="Incoming claim pages"
          />
        </>
      )}
    </section>
  );
}
