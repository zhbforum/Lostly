import { Link } from 'react-router';
import { ProfileLink } from '@/features/profile/ui/ProfileLink';
import { ClaimDecisionControls } from '../ClaimDecisionControls/ClaimDecisionControls';
import { type DecideClaimInput, type IncomingClaim } from '@/features/claims/model/types';
import styles from './IncomingClaims.module.css';
import { ReportButton } from '@/features/moderation/ReportButton';

interface Props {
  claim: IncomingClaim;
  disabled: boolean;
  isUpdating: boolean;
  error: string | null;
  clearError: () => void;
  onRefresh: () => void;
  onDecision: (id: string, input: DecideClaimInput) => Promise<boolean>;
}

export function IncomingClaimCard({ claim, ...decision }: Props) {
  return (
    <li className={styles.claim}>
      <div className={styles.claimHeader}>
        <div>
          <h3>
            <ProfileLink id={claim.claimant.id} name={claim.claimant.displayName} />
          </h3>
          <p>
            Submitted{' '}
            {new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(
              new Date(claim.createdAt),
            )}
          </p>
        </div>
        <span className={`${styles.claimStatus} ${styles[claim.status]}`}>{claim.status}</span>
      </div>
      <div className={styles.proof}>
        <p>Private proof of ownership</p>
        <blockquote>{claim.verificationDetails}</blockquote>
      </div>
      {claim.status === 'approved' && claim.handoverDetails && (
        <div className={styles.proof}>
          <p>Collection instructions shared with this claimant</p>
          <blockquote>{claim.handoverDetails}</blockquote>
        </div>
      )}
      <Link
        className={styles.conversation}
        to={`/messages/${encodeURIComponent(claim.conversationId)}`}
      >
        Open conversation
      </Link>
      {claim.status === 'pending' && <ClaimDecisionControls claimId={claim.id} {...decision} />}
      <ReportButton targetType="claim" targetId={claim.id} label="Report this claim" />
    </li>
  );
}
