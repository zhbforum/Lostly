import { eq } from 'drizzle-orm';
import type { DatabaseTransaction } from '@/db';
import { listings } from '@/db/schema';

// Every listing/claim mutation locks the listing first, before reading its state.
// Never lock a claim while waiting for its listing: closing a listing also updates
// pending claims under this same lock.
export async function lockListing(tx: DatabaseTransaction, listingId: string) {
  const [listing] = await tx
    .select({
      id: listings.id,
      kind: listings.kind,
      status: listings.status,
      isHidden: listings.isHidden,
      version: listings.version,
      createdByUserId: listings.createdByUserId,
    })
    .from(listings)
    .where(eq(listings.id, listingId))
    .for('update')
    .limit(1);
  return listing ?? null;
}
