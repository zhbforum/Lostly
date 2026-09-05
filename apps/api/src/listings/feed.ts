import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { PageQuery } from '@lostly/contracts/pagination';
import { db } from '@/db';
import { listings } from '@/db/schema';
import type { ListingFeedSort, ListingKind } from '@/domain/listing';
import { publicListingSelection } from '@/listings/selection';
import {
  cursorCondition,
  decodeCursor,
  pageFromRows,
  timestampCursorValue,
} from '@/pagination/cursor';

export interface ListListingsInput extends PageQuery {
  kind?: ListingKind;
  sort?: ListingFeedSort;
}

export function listActiveListings(input: ListListingsInput) {
  return listListings(input);
}

export function listOwnedListings(userId: string, input: ListListingsInput) {
  return listListings(input, userId);
}

async function listListings(input: ListListingsInput, ownerUserId?: string) {
  const sort = input.sort ?? 'newest';
  const dateOnly = sort === 'occurredOnAsc' || sort === 'occurredOnDesc';
  const ascending = sort === 'oldest' || sort === 'occurredOnAsc';
  const column = dateOnly ? listings.occurredOn : listings.createdAt;
  const scope = ['listings', ownerUserId ?? 'active', input.kind ?? 'all', sort].join(':');
  const cursor = input.cursor ? decodeCursor(input.cursor, scope, dateOnly) : null;
  if (input.cursor && !cursor) return { ok: false, reason: 'invalid-cursor' } as const;
  const limit = input.limit ?? 20;
  const order = ascending ? asc : desc;
  const rows = await db
    .select({
      ...publicListingSelection,
      cursorValue: dateOnly
        ? sql<string>`${listings.occurredOn}::text`
        : timestampCursorValue(listings.createdAt),
    })
    .from(listings)
    .where(
      and(
        ownerUserId ? eq(listings.createdByUserId, ownerUserId) : eq(listings.status, 'active'),
        input.kind ? eq(listings.kind, input.kind) : undefined,
        cursor ? cursorCondition(column, listings.id, cursor, ascending, dateOnly) : undefined,
      ),
    )
    .orderBy(order(column), order(listings.id))
    .limit(limit + 1);
  const { items, pageInfo } = pageFromRows(rows, limit, scope);
  return { ok: true, value: { listings: items, pageInfo } } as const;
}
