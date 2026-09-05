import { useId, useState } from 'react';
import { useFormDraft } from '@/shared/model/use-form-draft';
import {
  CLAIM_CONSTRAINTS,
  type DecideClaimInput,
  type IncomingClaim,
} from '@/features/claims/model/types';
import styles from './IncomingClaims.module.css';

interface Props {
  claim: IncomingClaim;
  disabled: boolean;
  isUpdating: boolean;
  onDecision: (id: string, input: DecideClaimInput) => Promise<boolean>;
}

export function IncomingClaimCard({ claim, disabled, isUpdating, onDecision }: Props) {
  const fieldId = useId();
  const [confirming, setConfirming] = useState(false);
  const [handover, setHandover, discardDraft] = useFormDraft('handover:' + claim.id, () => '');
  const [error, setError] = useState<string | null>(null);
  async function approve(event: React.FormEvent) {
    event.preventDefault();
    const value = handover.trim();
    if (
      value.length < CLAIM_CONSTRAINTS.handoverDetailsMinLength ||
      value.length > CLAIM_CONSTRAINTS.handoverDetailsMaxLength
    ) {
      setError('Provide collection instructions between 10 and 1000 characters.');
      return;
    }
    setError(null);
    if (await onDecision(claim.id, { decision: 'approved', handoverDetails: value }))
      discardDraft();
  }
  return (
    <li className={styles.claim}>
      <div className={styles.claimHeader}>
        <div>
          <h3>{claim.claimant.displayName}</h3>
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
      {claim.status === 'pending' &&
        (confirming ? (
          <form
            className={styles.confirmation}
            noValidate
            onSubmit={approve}
            aria-busy={isUpdating}
          >
            <label htmlFor={fieldId}>Private collection instructions</label>
            <p id={fieldId + '-hint'}>
              Only this claimant will receive these instructions. Explain where and how to collect
              the item, or provide a contact method you want to share.
            </p>
            <textarea
              id={fieldId}
              value={handover}
              disabled={disabled}
              maxLength={CLAIM_CONSTRAINTS.handoverDetailsMaxLength}
              aria-invalid={Boolean(error)}
              aria-describedby={fieldId + '-hint' + (error ? ' ' + fieldId + '-error' : '')}
              onChange={(event) => setHandover(event.target.value)}
            />
            {error && (
              <p id={fieldId + '-error'} role="alert">
                {error}
              </p>
            )}
            <p>
              Approving closes this report and rejects all other pending claims. This decision
              cannot be undone here.
            </p>
            <div className={styles.actions}>
              <button className={styles.approve} disabled={disabled} type="submit">
                {isUpdating ? 'Saving…' : 'Confirm approval'}
              </button>
              <button
                className={styles.reject}
                disabled={disabled}
                type="button"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className={styles.actions}>
            <button
              className={styles.approve}
              disabled={disabled}
              type="button"
              onClick={() => setConfirming(true)}
            >
              Approve claim
            </button>
            <button
              className={styles.reject}
              disabled={disabled}
              type="button"
              onClick={() => void onDecision(claim.id, { decision: 'rejected' })}
            >
              {isUpdating ? 'Saving…' : 'Reject'}
            </button>
          </div>
        ))}
    </li>
  );
}
