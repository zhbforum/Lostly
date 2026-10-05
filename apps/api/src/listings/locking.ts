import { eq } from 'drizzle-orm';
import type { DatabaseTransaction } from '@/db';
import { listings } from '@/db/schema';

// Every listing/claim mutation locks the listing FOR UPDATE first, before reading its state.
// Never lock a claim while waiting for its listing: closing a listing also updates
// pending claims under this same lock. Private media reads hold FOR SHARE through URL signing.
export async function lockListing(
  tx: DatabaseTransaction,
  listingId: string,
  strength: 'update' | 'share' = 'update',
) {
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
    .for(strength)
    .limit(1);
  return listing ?? null;
}
