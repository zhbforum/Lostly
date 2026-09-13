import { and, eq } from 'drizzle-orm';
import type { UpdateListingInput } from '@lostly/contracts/listings';
import { db, type DatabaseTransaction } from '@/db';
import { claims, listings } from '@/db/schema';
import { canArchiveListing, canEditListing, canResolveListing } from '@/domain/listing';
import { lockListing } from '@/listings/locking';
import { publicListingSelection } from '@/listings/selection';

type ListingRecord = Pick<typeof listings.$inferSelect, keyof typeof publicListingSelection>;
type ManagementFailure =
  | 'listing-not-found'
  | 'update-forbidden'
  | 'resolve-forbidden'
  | 'archive-forbidden'
  | 'not-editable'
  | 'version-conflict'
  | 'not-resolvable'
  | 'already-archived';
type ManagementResult =
  { ok: true; value: ListingRecord } | { ok: false; reason: ManagementFailure };
interface OwnerActionInput {
  listingId: string;
  ownerUserId: string;
}

export async function updateOwnedListing(
  input: OwnerActionInput & UpdateListingInput,
): Promise<ManagementResult> {
  return db.transaction(async (tx) => {
    const listing = await lockListing(tx, input.listingId);
    if (!listing) return { ok: false, reason: 'listing-not-found' };
    if (listing.createdByUserId !== input.ownerUserId)
      return { ok: false, reason: 'update-forbidden' };
    if (!canEditListing(listing.status)) return { ok: false, reason: 'not-editable' };
    if (listing.version !== input.expectedVersion) return { ok: false, reason: 'version-conflict' };

    const [updated] = await tx
      .update(listings)
      .set({
        title: input.title,
        description: input.description,
        location: input.location,
        occurredOn: input.occurredOn,
        version: listing.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(listings.id, listing.id))
      .returning(publicListingSelection);
    if (!updated) throw new Error('Failed to update locked listing');
    return { ok: true, value: updated };
  });
}

export function resolveOwnedListing(input: OwnerActionInput): Promise<ManagementResult> {
  return closeOwnedListing(input, 'resolved');
}

export function archiveOwnedListing(input: OwnerActionInput): Promise<ManagementResult> {
  return closeOwnedListing(input, 'archived');
}

async function closeOwnedListing(
  input: OwnerActionInput,
  target: 'resolved' | 'archived',
): Promise<ManagementResult> {
  return db.transaction(async (tx) => {
    const listing = await lockListing(tx, input.listingId);
    if (!listing) return { ok: false, reason: 'listing-not-found' };
    if (listing.createdByUserId !== input.ownerUserId)
      return {
        ok: false,
        reason: target === 'resolved' ? 'resolve-forbidden' : 'archive-forbidden',
      };
    if (target === 'resolved' && !canResolveListing(listing.status))
      return { ok: false, reason: 'not-resolvable' };
    if (target === 'archived' && !canArchiveListing(listing.status))
      return { ok: false, reason: 'already-archived' };

    const updated = await closeLockedListing(tx, listing, input.ownerUserId, target);
    return { ok: true, value: updated };
  });
}

// Caller holds the parent row lock and has checked authorization and transition policy.
export async function closeLockedListing(
  tx: DatabaseTransaction,
  listing: NonNullable<Awaited<ReturnType<typeof lockListing>>>,
  actorUserId: string,
  target: 'resolved' | 'archived',
  now = new Date(),
) {
  const [updated] = await tx
    .update(listings)
    .set({ status: target, version: listing.version + 1, updatedAt: now })
    .where(eq(listings.id, listing.id))
    .returning(publicListingSelection);
  if (!updated) throw new Error('Failed to close locked listing');

  if (listing.status === 'active') {
    await tx
      .update(claims)
      .set({
        status: 'rejected',
        reviewedByUserId: actorUserId,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(and(eq(claims.listingId, listing.id), eq(claims.status, 'pending')));
  }
  return updated;
}
