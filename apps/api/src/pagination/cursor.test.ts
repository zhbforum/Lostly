import { describe, expect, test } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { cursorCondition, decodeCursor, pageFromRows } from '@/pagination/cursor';

const id = '550e8400-e29b-41d4-a716-446655440001';
const precise = '2026-09-01T10:00:00.123456Z';
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('keyset cursor', () => {
  test('preserves all six fractional digits through the next SQL boundary', () => {
    const page = pageFromRows(
      [
        { id, cursorValue: precise },
        { id, cursorValue: precise },
      ],
      1,
      'test',
    );
    const cursor = decodeCursor(page.pageInfo.endCursor!, 'test');
    expect(cursor?.value).toBe(precise);
    expect(page.items[0]).not.toHaveProperty('cursorValue');
    if (!cursor) throw new Error('Missing cursor');
    const query = new PgDialect().sqlToQuery(
      cursorCondition(sql`created_at`, sql`id`, cursor, true),
    );
    expect(query.params).toEqual([precise, id]);
  });

  test('rejects a cursor reused with another filter, user or ordering', () => {
    const cursor = encode({ v: 1, scope: 'user-a', id, value: precise });
    expect(decodeCursor(cursor, 'user-b')).toBeNull();
  });

  test.each([
    null,
    {},
    { v: 1, scope: 'test', id: 'not-uuid', value: precise },
    { v: 1, scope: 'test', id, value: '2026-02-30T10:00:00.123456Z' },
    { v: 1, scope: 'test', id, value: '2026-09-01T25:00:00.123456Z' },
    { v: 0, scope: 'test', id, value: precise },
  ])('rejects malformed boundaries: %j', (value) => {
    expect(decodeCursor(encode(value), 'test')).toBeNull();
  });
});
