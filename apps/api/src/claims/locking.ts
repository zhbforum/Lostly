import { eq } from 'drizzle-orm';
import type { db } from '@/db';
import { listings } from '@/db/schema';

export type ClaimTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Every claim mutation locks the listing first. Never lock a claim while waiting
// for its listing: approval also updates competing claims under this same lock.
export async function lockListing(tx: ClaimTransaction, listingId: string) {
  const [listing] = await tx
    .select({
      id: listings.id,
      kind: listings.kind,
      status: listings.status,
      createdByUserId: listings.createdByUserId,
    })
    .from(listings)
    .where(eq(listings.id, listingId))
    .for('update')
    .limit(1);
  return listing ?? null;
}
