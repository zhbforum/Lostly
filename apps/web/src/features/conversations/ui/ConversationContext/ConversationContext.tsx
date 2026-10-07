import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ConversationDetail } from '../../model/types';
import styles from './ConversationContext.module.css';
import { ClaimDecisionControls } from '@/features/claims/ui/ClaimDecisionControls/ClaimDecisionControls';
import type { useClaimDecision } from '@/features/claims/model/use-claim-decision';

export function ConversationContext({
  conversation,
  decision,
}: {
  conversation: ConversationDetail;
  decision: ReturnType<typeof useClaimDecision>;
}) {
  const { listing, claim, participantRole } = conversation;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [focusAfterDecision, setFocusAfterDecision] = useState<{
    claimId: string;
    status: 'approved' | 'rejected';
  } | null>(null);
  const focusedDecision = useRef<typeof focusAfterDecision>(null);
  useEffect(() => {
    if (
      focusAfterDecision === focusedDecision.current ||
      focusAfterDecision?.claimId !== claim.id ||
      focusAfterDecision.status !== claim.status
    )
      return;
    // Wait for the confirmed context render: the dialog and its focus scope are now gone.
    // Consume this intent once; later polling must not move focus back from the composer.
    focusedDecision.current = focusAfterDecision;
    title.current?.focus();
  }, [claim.id, claim.status, focusAfterDecision]);

  const submitDecision: typeof decision.submit = async (id, input) => {
    const saved = await decision.submit(id, input);
    if (saved) setFocusAfterDecision({ claimId: id, status: input.decision });
    return saved;
  };
  return (
    <section className={styles.context} aria-label="Claim and item details">
      <div className={styles.item}>
        {listing.coverImage && listing.coverImage.url !== failedUrl && (
          <img
            src={listing.coverImage.url}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setFailedUrl(listing.coverImage!.url)}
          />
        )}
        <div>
          <h3 ref={title} tabIndex={-1}>
            {listing.title}
          </h3>
          <p>
            {listing.kind === 'found' ? 'Found' : 'Lost'} item · {listing.status}
          </p>
          <p>{listing.location}</p>
        </div>
        <Link
          to={`/listings/${encodeURIComponent(listing.id)}`}
          state={{
            returnTo: `/messages/${encodeURIComponent(conversation.id)}`,
            conversationReturnSteps: 1,
          }}
        >
          View report <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className={styles.status}>
        <strong>
          {claim.status === 'approved'
            ? '✓ Claim approved'
            : claim.status === 'rejected'
              ? 'Claim closed'
              : 'Claim awaiting review'}
        </strong>
        {claim.status === 'pending' && (
          <p>
            {participantRole === 'claimant'
              ? 'The finder is reviewing your ownership details.'
              : 'Ownership details are awaiting your review.'}
          </p>
        )}
        {claim.status === 'approved' && claim.handoverDetails && (
          <div className={styles.handover}>
            <h4>Collection instructions</h4>
            <p>{claim.handoverDetails}</p>
          </div>
        )}
      </div>
      <details>
        <summary>Ownership verification</summary>
        <p className={styles.proof}>{claim.verificationDetails}</p>
      </details>
      {participantRole === 'owner' && claim.status === 'pending' && (
        <ClaimDecisionControls
          claimId={claim.id}
          disabled={decision.pendingId !== null}
          isUpdating={decision.pendingId === claim.id}
          error={decision.error}
          clearError={decision.clearError}
          onDecision={submitDecision}
          onRefresh={decision.reconcile}
        />
      )}
    </section>
  );
}
