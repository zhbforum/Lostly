import type { Claim } from '@/features/claims/model/types';
import styles from './ClaimStatus.module.css';

interface ClaimStatusProps {
  claim: Claim;
  onRefresh: () => void;
}

const STATUS_CONTENT: Record<Claim['status'], { title: string; description: string }> = {
  pending: {
    title: 'Your claim is awaiting review',
    description: 'The finder can review your private verification details before deciding.',
  },
  approved: {
    title: 'Your claim was approved',
    description:
      'The report owner has confirmed your claim. Follow their private collection instructions below.',
  },
  rejected: {
    title: 'Your claim was not approved',
    description: 'The report owner declined your claim or approved another claim for this item.',
  },
};

export function ClaimStatus({ claim, onRefresh }: ClaimStatusProps) {
  const content = STATUS_CONTENT[claim.status];

  return (
    <section
      className={`${styles.panel} ${styles[claim.status]}`}
      aria-labelledby="claim-status-heading"
    >
      <p className={styles.eyebrow}>Private claim</p>
      <h2 id="claim-status-heading">{content.title}</h2>
      <p>{content.description}</p>
      {claim.status === 'approved' && (
        <div className={styles.handover}>
          <h3>Private collection instructions</h3>
          <p>{claim.handoverDetails ?? 'The finder has not supplied collection instructions.'}</p>
        </div>
      )}
      <button type="button" onClick={onRefresh}>
        Refresh status
      </button>
    </section>
  );
}
