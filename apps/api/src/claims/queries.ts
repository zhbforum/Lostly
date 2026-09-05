import { and, desc, eq } from 'drizzle-orm';
import type { PageQuery } from '@lostly/contracts/pagination';
import { db } from '@/db';
import { claims, listings, users } from '@/db/schema';
import { claimSelection } from '@/claims/selection';
import {
  cursorCondition,
  decodeCursor,
  pageFromRows,
  timestampCursorValue,
} from '@/pagination/cursor';

export async function findClaimForClaimant(listingId: string, claimantUserId: string) {
  const [claim] = await db
    .select(claimSelection)
    .from(claims)
    .where(and(eq(claims.listingId, listingId), eq(claims.claimantUserId, claimantUserId)))
    .limit(1);
  return claim ?? null;
}

export async function findIncomingClaims(
  listingId: string,
  ownerUserId: string,
  query: PageQuery = {},
) {
  const [listing] = await db
    .select({ ownerId: listings.createdByUserId })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  if (!listing) return { ok: false, reason: 'listing-not-found' } as const;
  if (listing.ownerId !== ownerUserId) return { ok: false, reason: 'review-forbidden' } as const;
  const scope = ['incoming', ownerUserId, listingId].join(':');
  const cursor = query.cursor ? decodeCursor(query.cursor, scope) : null;
  if (query.cursor && !cursor) return { ok: false, reason: 'invalid-cursor' } as const;
  const limit = query.limit ?? 20;
  const rows = await db
    .select({
      ...claimSelection,
      claimant: { id: users.id, displayName: users.displayName },
      cursorValue: timestampCursorValue(claims.createdAt),
    })
    .from(claims)
    .innerJoin(users, eq(users.id, claims.claimantUserId))
    .where(
      and(
        eq(claims.listingId, listingId),
        cursor ? cursorCondition(claims.createdAt, claims.id, cursor, false) : undefined,
      ),
    )
    .orderBy(desc(claims.createdAt), desc(claims.id))
    .limit(limit + 1);
  const { items, pageInfo } = pageFromRows(rows, limit, scope);
  return { ok: true, value: { claims: items, pageInfo } } as const;
}

// Activity summaries deliberately omit proof and handover instructions.
export async function listClaimActivity(
  userId: string,
  direction: 'incoming' | 'outgoing',
  query: PageQuery,
) {
  const scope = ['claim-activity', userId, direction].join(':');
  const cursor = query.cursor ? decodeCursor(query.cursor, scope) : null;
  if (query.cursor && !cursor) return { ok: false, reason: 'invalid-cursor' } as const;
  const limit = query.limit ?? 20;
  const rows = await db
    .select({
      id: claims.id,
      status: claims.status,
      createdAt: claims.createdAt,
      listing: { id: listings.id, title: listings.title, status: listings.status },
      cursorValue: timestampCursorValue(claims.createdAt),
    })
    .from(claims)
    .innerJoin(listings, eq(listings.id, claims.listingId))
    .where(
      and(
        direction === 'incoming'
          ? eq(listings.createdByUserId, userId)
          : eq(claims.claimantUserId, userId),
        cursor ? cursorCondition(claims.createdAt, claims.id, cursor, false) : undefined,
      ),
    )
    .orderBy(desc(claims.createdAt), desc(claims.id))
    .limit(limit + 1);
  const { items, pageInfo } = pageFromRows(rows, limit, scope);
  return { ok: true, value: { claims: items, pageInfo } } as const;
}
