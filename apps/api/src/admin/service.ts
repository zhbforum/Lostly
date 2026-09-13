import { and, count, desc, eq } from 'drizzle-orm';
import type { PageQuery } from '@lostly/contracts/pagination';
import type { ArchiveListingInput, ModerationInput } from '@lostly/contracts/admin';
import { db } from '@/db';
import { claims, listings, moderationEvents, users } from '@/db/schema';
import { canArchiveListing } from '@/domain/listing';
import { lockListing } from '@/listings/locking';
import { closeLockedListing } from '@/listings/management';
import { publicListingSelection } from '@/listings/selection';
import {
  cursorCondition,
  decodeCursor,
  pageFromRows,
  timestampCursorValue,
} from '@/pagination/cursor';

export async function adminOverview() {
  const [[userCount], [listingCount], [activeCount], [pendingCount]] = await Promise.all([
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(listings),
    db.select({ value: count() }).from(listings).where(eq(listings.status, 'active')),
    db.select({ value: count() }).from(claims).where(eq(claims.status, 'pending')),
  ]);
  return {
    users: userCount!.value,
    listings: listingCount!.value,
    activeListings: activeCount!.value,
    pendingClaims: pendingCount!.value,
  };
}

export async function adminRecords(resource: 'listings' | 'users' | 'claims', query: PageQuery) {
  const table = { listings, users, claims }[resource];
  const scope = 'admin:' + resource;
  const cursor = query.cursor ? decodeCursor(query.cursor, scope) : null;
  if (query.cursor && !cursor) return null;
  const limit = query.limit ?? 20;
  const condition = cursor ? cursorCondition(table.createdAt, table.id, cursor, false) : undefined;
  const order = [desc(table.createdAt), desc(table.id)];
  const cursorValue = timestampCursorValue(table.createdAt);

  if (resource === 'listings') {
    const rows = await db
      .select({
        ...publicListingSelection,
        owner: { id: users.id, displayName: users.displayName },
        cursorValue,
      })
      .from(listings)
      .innerJoin(users, eq(users.id, listings.createdByUserId))
      .where(condition)
      .orderBy(...order)
      .limit(limit + 1);
    return pageFromRows(rows, limit, scope);
  }
  if (resource === 'users') {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        createdAt: users.createdAt,
        cursorValue,
      })
      .from(users)
      .where(condition)
      .orderBy(...order)
      .limit(limit + 1);
    return pageFromRows(rows, limit, scope);
  }
  const rows = await db
    .select({
      id: claims.id,
      status: claims.status,
      createdAt: claims.createdAt,
      listing: { id: listings.id, title: listings.title, status: listings.status },
      claimant: { id: users.id, displayName: users.displayName },
      cursorValue,
    })
    .from(claims)
    .innerJoin(listings, eq(listings.id, claims.listingId))
    .innerJoin(users, eq(users.id, claims.claimantUserId))
    .where(condition)
    .orderBy(...order)
    .limit(limit + 1);
  return pageFromRows(rows, limit, scope);
}

export async function moderateListing(id: string, actorUserId: string, input: ArchiveListingInput) {
  return db.transaction(async (tx) => {
    const listing = await lockListing(tx, id);
    if (!listing) return 'not-found' as const;
    if (!canArchiveListing(listing.status) || listing.version !== input.expectedVersion)
      return 'conflict' as const;
    const now = new Date();
    await closeLockedListing(tx, listing, actorUserId, 'archived', now);
    await tx.insert(moderationEvents).values({
      actorUserId,
      targetId: id,
      action: 'archive_listing',
      reason: input.reason,
      createdAt: now,
    });
    return 'ok' as const;
  });
}

export async function moderateClaim(id: string, actorUserId: string, input: ModerationInput) {
  return db.transaction(async (tx) => {
    const [reference] = await tx
      .select({ listingId: claims.listingId })
      .from(claims)
      .where(eq(claims.id, id))
      .limit(1);
    if (!reference) return 'not-found' as const;
    const listing = await lockListing(tx, reference.listingId);
    if (!listing) return 'not-found' as const;
    if (listing.status !== 'active') return 'conflict' as const;
    const now = new Date();
    const [updated] = await tx
      .update(claims)
      .set({
        status: 'rejected',
        reviewedByUserId: actorUserId,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(and(eq(claims.id, id), eq(claims.status, 'pending')))
      .returning({ id: claims.id });
    if (!updated) return 'conflict' as const;
    await tx.insert(moderationEvents).values({
      actorUserId,
      targetId: id,
      action: 'reject_claim',
      reason: input.reason,
      createdAt: now,
    });
    return 'ok' as const;
  });
}
