import { sql, type SQLWrapper } from 'drizzle-orm';
import type { PageInfo } from '@lostly/contracts/pagination';

interface Cursor {
  v: 1;
  scope: string;
  value: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Read the full PostgreSQL precision as text; Date would discard microseconds.
export function timestampCursorValue(column: SQLWrapper) {
  return sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export function decodeCursor(encoded: string, scope: string, dateOnly = false): Cursor | null {
  try {
    if (encoded.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
    const value: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object') return null;
    const cursor = value as Partial<Cursor>;
    if (
      cursor.v !== 1 ||
      cursor.scope !== scope ||
      typeof cursor.id !== 'string' ||
      !UUID.test(cursor.id) ||
      typeof cursor.value !== 'string' ||
      !validDate(cursor.value, dateOnly)
    ) {
      return null;
    }
    return cursor as Cursor;
  } catch {
    return null;
  }
}

function validDate(value: string, dateOnly: boolean): boolean {
  const pattern = dateOnly
    ? /^\d{4}-\d{2}-\d{2}$/
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
  if (!pattern.test(value) || value.startsWith('0000')) return false;
  const date = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.valueOf())) return false;
  return dateOnly
    ? date.toISOString().slice(0, 10) === value
    : date.toISOString() === `${value.slice(0, 23)}Z`;
}

export function cursorCondition(
  column: SQLWrapper,
  idColumn: SQLWrapper,
  cursor: Cursor,
  ascending: boolean,
  dateOnly = false,
) {
  const comparison = ascending ? sql`>` : sql`<`;
  const value = dateOnly ? sql`${cursor.value}::date` : sql`${cursor.value}::timestamptz`;
  return sql`(${column}, ${idColumn}) ${comparison} (${value}, ${cursor.id}::uuid)`;
}

export function pageFromRows<T extends { id: string; cursorValue: string }>(
  rows: T[],
  limit: number,
  scope: string,
): { items: Omit<T, 'cursorValue'>[]; pageInfo: PageInfo } {
  const hasNextPage = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const endCursor =
    hasNextPage && last
      ? Buffer.from(
          JSON.stringify({
            v: 1,
            scope,
            value: last.cursorValue,
            id: last.id,
          } satisfies Cursor),
        ).toString('base64url')
      : null;
  return {
    items: page.map(({ cursorValue, ...item }) => {
      void cursorValue;
      return item;
    }),
    pageInfo: { endCursor, hasNextPage },
  };
}
