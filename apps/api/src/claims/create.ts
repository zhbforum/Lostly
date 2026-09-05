import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { claims } from '@/db/schema';
import { isClaimableListingKind } from '@/domain/claim';
import { lockListing } from '@/claims/locking';
import { claimSelection, type ClaimRecord, type ClaimResult } from '@/claims/selection';

export async function createClaim(input: {
  listingId: string;
  claimantUserId: string;
  verificationDetails: string;
}): Promise<ClaimResult<ClaimRecord>> {
  return db.transaction(async (tx) => {
    const listing = await lockListing(tx, input.listingId);
    if (!listing) return { ok: false, reason: 'listing-not-found' };
    if (listing.createdByUserId === input.claimantUserId)
      return { ok: false, reason: 'cannot-claim-own-listing' };
    if (!isClaimableListingKind(listing.kind) || listing.status !== 'active')
      return { ok: false, reason: 'listing-not-claimable' };
    const [existing] = await tx
      .select({ id: claims.id })
      .from(claims)
      .where(
        and(eq(claims.listingId, input.listingId), eq(claims.claimantUserId, input.claimantUserId)),
      )
      .limit(1);
    if (existing) return { ok: false, reason: 'claim-already-exists' };
    const [claim] = await tx
      .insert(claims)
      .values({
        listingId: input.listingId,
        claimantUserId: input.claimantUserId,
        verificationDetails: input.verificationDetails,
      })
      .returning(claimSelection);
    if (!claim) throw new Error('Failed to create claim');
    return { ok: true, value: claim };
  });
}
