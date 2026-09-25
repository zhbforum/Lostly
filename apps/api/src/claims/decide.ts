import { and, eq } from 'drizzle-orm';
import type { DecideClaimInput } from '@lostly/contracts/claims';
import { db } from '@/db';
import { claims, listings } from '@/db/schema';
import { claimConversations } from '@/db/conversations';
import { canTransitionClaimStatus } from '@/domain/claim';
import { lockListing } from '@/listings/locking';
import {
  claimSelection,
  participantClaimSelection,
  type ParticipantClaimRecord,
  type ClaimResult,
} from '@/claims/selection';

export async function decideClaim(
  input: DecideClaimInput & {
    claimId: string;
    reviewerUserId: string;
  },
): Promise<ClaimResult<ParticipantClaimRecord>> {
  return db.transaction(async (tx) => {
    // Only locate the parent here, without locking the child or using its status.
    const [reference] = await tx
      .select({ listingId: claims.listingId })
      .from(claims)
      .where(eq(claims.id, input.claimId))
      .limit(1);
    if (!reference) return { ok: false, reason: 'claim-not-found' };
    const listing = await lockListing(tx, reference.listingId);
    if (!listing || listing.isHidden) return { ok: false, reason: 'claim-not-found' };
    if (listing.createdByUserId !== input.reviewerUserId)
      return { ok: false, reason: 'review-forbidden' };
    const [claim] = await tx
      .select(participantClaimSelection)
      .from(claims)
      .innerJoin(claimConversations, eq(claimConversations.claimId, claims.id))
      .where(eq(claims.id, input.claimId))
      .for('update', { of: claims })
      .limit(1);
    if (!claim) return { ok: false, reason: 'claim-not-found' };
    if (!canTransitionClaimStatus(claim.status, input.decision) || listing.status !== 'active') {
      return { ok: false, reason: 'claim-already-decided' };
    }
    const now = new Date();
    const review = { reviewedByUserId: input.reviewerUserId, reviewedAt: now, updatedAt: now };
    const [updated] = await tx
      .update(claims)
      .set({
        ...review,
        status: input.decision,
        handoverDetails: input.decision === 'approved' ? input.handoverDetails : null,
      })
      .where(eq(claims.id, claim.id))
      .returning(claimSelection);
    if (!updated) throw new Error('Failed to update locked claim');
    if (input.decision === 'approved') {
      await tx
        .update(listings)
        .set({ status: 'resolved', version: listing.version + 1, updatedAt: now })
        .where(eq(listings.id, listing.id));
      await tx
        .update(claims)
        .set({ ...review, status: 'rejected' })
        .where(and(eq(claims.listingId, listing.id), eq(claims.status, 'pending')));
    }
    return { ok: true, value: { ...updated, conversationId: claim.conversationId } };
  });
}
