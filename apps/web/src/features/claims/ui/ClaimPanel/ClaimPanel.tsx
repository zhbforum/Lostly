import type { Claim } from '@/features/claims/model/types';
import { ClaimStatus } from '@/features/claims/ui/ClaimStatus/ClaimStatus';
import { ClaimSubmissionForm } from '@/features/claims/ui/ClaimSubmissionForm/ClaimSubmissionForm';
import { IncomingClaims } from '@/features/claims/ui/IncomingClaims/IncomingClaims';
import type { ListingCapabilities } from '@/features/listings/model/types';
import styles from './ClaimPanel.module.css';

interface ClaimPanelProps {
  listingId: string;
  capabilities: ListingCapabilities;
  initialClaim: Claim | null;
  onChanged: () => void;
}

export function ClaimPanel({
  listingId,
  capabilities,
  initialClaim: claim,
  onChanged,
}: ClaimPanelProps) {
  if (capabilities.canReviewClaims) {
    return (
      <div className={styles.panel}>
        <IncomingClaims listingId={listingId} onChanged={onChanged} />
      </div>
    );
  }

  if (claim) {
    return (
      <div className={styles.panel}>
        <ClaimStatus claim={claim} onRefresh={onChanged} />
      </div>
    );
  }

  if (capabilities.canClaim) {
    return (
      <div className={styles.panel}>
        <ClaimSubmissionForm listingId={listingId} onCreated={onChanged} />
      </div>
    );
  }

  return null;
}
