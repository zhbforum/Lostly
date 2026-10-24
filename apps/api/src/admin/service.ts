import { and, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { audit, notify } from '@/moderation/audit';
import type {
  AdminRecordsQuery,
  ArchiveListingInput,
  ListingVisibilityInput,
  ModerationInput,
} from '@lostly/contracts/admin';
import type { ListingStatus } from '@lostly/contracts/listings';
import type { ClaimStatus } from '@lostly/contracts/claims';
import type { PageQuery } from '@lostly/contracts/pagination';
import type { ObjectStorage } from '@/storage/object-storage';
import { findImages, toListingImage } from '@/listing-images/queries';
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
    db
      .select({ value: count() })
      .from(listings)
      .where(and(eq(listings.status, 'active'), eq(listings.isHidden, false))),
    db.select({ value: count() }).from(claims).where(eq(claims.status, 'pending')),
  ]);
  return {
    users: userCount!.value,
    listings: listingCount!.value,
    activeListings: activeCount!.value,
    pendingClaims: pendingCount!.value,
  };
}

export async function adminRecords(
  resource: 'listings' | 'users' | 'claims',
  query: AdminRecordsQuery,
) {
  const table = { listings, users, claims }[resource];
  const search = query.q?.trim().toLowerCase() ?? '';
  const scope = JSON.stringify([
    'admin',
    resource,
    search,
    query.kind ?? '',
    query.status ?? '',
    query.visibility ?? '',
    query.userId ?? '',
    query.listingId ?? '',
    query.from ?? '',
    query.to ?? '',
    query.restriction ?? '',
  ]);
  const cursor = query.cursor ? decodeCursor(query.cursor, scope) : null;
  if (query.cursor && !cursor) return null;
  const limit = query.limit ?? 20;
  const condition = and(
    cursor ? cursorCondition(table.createdAt, table.id, cursor, false) : undefined,
    query.from ? gte(table.createdAt, new Date(query.from)) : undefined,
    query.to ? lte(table.createdAt, new Date(query.to)) : undefined,
  );
  const order = [desc(table.createdAt), desc(table.id)];
  const cursorValue = timestampCursorValue(table.createdAt);
  // ponytail: substring scans; add trigram indexes if moderation search volume warrants them.
  const pattern = '%' + search.replace(/[\\%_]/g, '\\$&') + '%';

  if (resource === 'listings') {
    const rows = await db
      .select({
        ...publicListingSelection,
        isHidden: listings.isHidden,
        owner: { id: users.id, displayName: users.displayName },
        cursorValue,
      })
      .from(listings)
      .innerJoin(users, eq(users.id, listings.createdByUserId))
      .where(
        and(
          condition,
          query.userId ? eq(listings.createdByUserId, query.userId) : undefined,
          query.listingId ? eq(listings.id, query.listingId) : undefined,
          query.visibility ? eq(listings.isHidden, query.visibility === 'hidden') : undefined,
          query.kind ? eq(listings.kind, query.kind) : undefined,
          query.status ? eq(listings.status, query.status as ListingStatus) : undefined,
          search
            ? or(
                ilike(listings.title, pattern),
                ilike(listings.description, pattern),
                ilike(listings.location, pattern),
                sql`${listings.id}::text = ${search}`,
              )
            : undefined,
        ),
      )
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
        restricted: sql<boolean>`(${users.suspendedPermanently} or coalesce(${users.suspendedUntil} > now(), false))`,
        cursorValue,
      })
      .from(users)
      .where(
        and(
          condition,
          query.userId ? eq(users.id, query.userId) : undefined,
          query.restriction
            ? sql`(${users.suspendedPermanently} or coalesce(${users.suspendedUntil} > now(), false)) = ${query.restriction === 'active'}`
            : undefined,
          search
            ? or(
                ilike(users.email, pattern),
                ilike(users.displayName, pattern),
                ilike(users.username, pattern),
                sql`${users.id}::text = ${search}`,
              )
            : undefined,
        ),
      )
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
    .where(
      and(
        condition,
        query.userId
          ? or(eq(claims.claimantUserId, query.userId), eq(listings.createdByUserId, query.userId))
          : undefined,
        query.listingId ? eq(claims.listingId, query.listingId) : undefined,
        query.status ? eq(claims.status, query.status as ClaimStatus) : undefined,
        search
          ? or(
              ilike(listings.title, pattern),
              ilike(users.displayName, pattern),
              sql`${claims.id}::text = ${search}`,
              sql`${listings.id}::text = ${search}`,
            )
          : undefined,
      ),
    )
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
    const pending = await tx
      .select({ id: claims.id, userId: claims.claimantUserId })
      .from(claims)
      .where(and(eq(claims.listingId, id), eq(claims.status, 'pending')));
    await closeLockedListing(tx, listing, actorUserId, 'archived', now);
    const event = await audit(tx, {
      actorUserId,
      targetId: id,
      targetType: 'listing',
      caseId: input.caseId,
      action: 'archive_listing',
      reason: input.reason,
      createdAt: now,
      metadata: {
        before: listing.status,
        after: 'archived',
        afterVersion: listing.version + 1,
        reviewedAt: now.toISOString(),
      },
    });
    await notify(tx, event, {
      userId: listing.createdByUserId,
      title: 'Report archived',
      message:
        input.publicReason ?? 'A moderator archived your report. Pending claims were closed.',
      canAppeal: true,
    });
    for (const claim of pending) {
      const child = await audit(tx, {
        actorUserId,
        targetId: claim.id,
        targetType: 'claim',
        action: 'reject_claim',
        reason: input.reason,
        parentEventId: event.id,
        caseId: input.caseId,
        createdAt: now,
        metadata: { listingId: id, cause: 'listing_archived', reviewedAt: now.toISOString() },
      });
      await notify(tx, child, {
        userId: claim.userId,
        title: 'Claim closed',
        message: 'Your claim was closed because its report was archived by a moderator.',
        canAppeal: true,
      });
    }
    return 'ok' as const;
  });
}

export async function adminReview(
  resource: 'listings' | 'claims',
  id: string,
  query: PageQuery,
  storage: ObjectStorage,
) {
  const table = resource === 'listings' ? listings : claims;
  const [target] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
  if (!target) return 'not-found' as const;
  const scope = 'admin-review:' + resource + ':' + id;
  const cursor = query.cursor ? decodeCursor(query.cursor, scope) : null;
  if (query.cursor && !cursor) return 'invalid-cursor' as const;
  const limit = query.limit ?? 20;
  const rows = await db
    .select({
      id: moderationEvents.id,
      actorUserId: moderationEvents.actorUserId,
      actorName: users.displayName,
      action: moderationEvents.action,
      reason: moderationEvents.reason,
      createdAt: moderationEvents.createdAt,
      cursorValue: timestampCursorValue(moderationEvents.createdAt),
    })
    .from(moderationEvents)
    .leftJoin(users, eq(users.id, moderationEvents.actorUserId))
    .where(
      and(
        eq(moderationEvents.targetId, id),
        eq(moderationEvents.targetType, resource === 'listings' ? 'listing' : 'claim'),
        cursor
          ? cursorCondition(moderationEvents.createdAt, moderationEvents.id, cursor, false)
          : undefined,
      ),
    )
    .orderBy(desc(moderationEvents.createdAt), desc(moderationEvents.id))
    .limit(limit + 1);
  return {
    images:
      resource === 'listings'
        ? (await findImages(id)).map((image) => toListingImage(image, storage))
        : [],
    events: pageFromRows(rows, limit, scope),
  };
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
    const event = await audit(tx, {
      actorUserId,
      targetId: id,
      targetType: 'claim',
      caseId: input.caseId,
      action: 'reject_claim',
      reason: input.reason,
      createdAt: now,
      metadata: { listingId: listing.id, reviewedAt: now.toISOString() },
    });
    const [claim] = await tx
      .select({ userId: claims.claimantUserId })
      .from(claims)
      .where(eq(claims.id, id));
    await notify(tx, event, {
      userId: claim!.userId,
      title: 'Claim rejected',
      message: input.publicReason ?? 'A moderator rejected your claim.',
      canAppeal: true,
    });
    return 'ok' as const;
  });
}

export async function setListingVisibility(
  id: string,
  actorUserId: string,
  action: 'hide' | 'restore',
  input: ListingVisibilityInput,
) {
  return db.transaction(async (tx) => {
    const listing = await lockListing(tx, id);
    if (!listing) return 'not-found' as const;
    const isHidden = action === 'hide';
    if (listing.isHidden === isHidden || listing.version !== input.expectedVersion)
      return 'conflict' as const;
    const now = new Date();
    await tx
      .update(listings)
      .set({ isHidden, version: listing.version + 1, updatedAt: now })
      .where(eq(listings.id, id));
    const event = await audit(tx, {
      actorUserId,
      targetId: id,
      targetType: 'listing',
      caseId: input.caseId,
      action: isHidden ? 'hide_listing' : 'restore_listing',
      reason: input.reason,
      createdAt: now,
      metadata: { before: listing.isHidden, after: isHidden },
    });
    await notify(tx, event, {
      userId: listing.createdByUserId,
      title: isHidden ? 'Report hidden' : 'Report restored',
      message:
        input.publicReason ??
        (isHidden
          ? 'A moderator hid your report. Open moderation notices to view the decision or appeal.'
          : 'Your report is available again with its previous status.'),
      canAppeal: isHidden,
    });
    const participants = await tx
      .select({ id: claims.claimantUserId })
      .from(claims)
      .where(eq(claims.listingId, id));
    for (const person of participants)
      await notify(tx, event, {
        userId: person.id,
        title: isHidden ? 'Report temporarily unavailable' : 'Report available again',
        message: isHidden
          ? 'A report linked to your claim is temporarily unavailable following moderation. Your claim history is preserved.'
          : 'A report linked to your claim is available again.',
      });
    return 'ok' as const;
  });
}
