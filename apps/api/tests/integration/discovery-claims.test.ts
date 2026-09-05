import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import type {
  ClaimResponse,
  IncomingClaimsResponse,
  ClaimActivityResponse,
} from '@lostly/contracts/claims';
import type { ListingDetailResponse, ListingListResponse } from '@lostly/contracts/listings';
import { app } from '@/app';
import { db } from '@/db';
import { claims, listings, sessions, users } from '@/db/schema';
import { generateSessionToken, hashSessionToken, getSessionExpiresAt } from '@/auth/session';
import { listClaimActivity } from '@/claims/queries';

if (!process.env.DATABASE_URL?.endsWith('/lostly_test'))
  throw new Error('Integration tests require lostly_test');

async function clearDatabase() {
  await db.delete(claims);
  await db.delete(listings);
  await db.delete(users);
}
beforeEach(clearDatabase);
afterAll(clearDatabase);

async function user(name: string) {
  const [record] = await db
    .insert(users)
    .values({ email: name + '@example.com', displayName: name, passwordHash: 'unused-test-hash' })
    .returning();
  if (!record) throw new Error('Failed to create fixture');
  const token = generateSessionToken();
  await db.insert(sessions).values({
    userId: record.id,
    tokenHash: hashSessionToken(token),
    expiresAt: getSessionExpiresAt(),
  });
  return { id: record.id, cookie: 'lostly_session=' + token };
}

function request(
  path: string,
  cookie?: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
) {
  const headers = new Headers({ 'X-CSRF-Protection': '1' });
  if (cookie) headers.set('cookie', cookie);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return app.handle(
    new Request('http://localhost' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function report(ownerId: string) {
  const [record] = await db
    .insert(listings)
    .values({
      createdByUserId: ownerId,
      kind: 'found',
      title: 'Blue backpack',
      description: 'Found backpack',
      location: 'Berlin',
      occurredOn: '2026-09-01',
    })
    .returning();
  if (!record) throw new Error('Failed to create fixture');
  return record;
}

async function submit(listingId: string, cookie: string) {
  const response = await request('/listings/' + listingId + '/claims', cookie, {
    verificationDetails: 'Private proof: red notebook inside.',
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as ClaimResponse).claim;
}

describe('discovery regressions', () => {
  test('paginates all orderings without repeating or skipping equal/microsecond timestamps', async () => {
    const owner = await user('finder');
    const ids = [
      '550e8400-e29b-41d4-a716-446655440001',
      '550e8400-e29b-41d4-a716-446655440002',
      '550e8400-e29b-41d4-a716-446655440003',
    ] as const;
    for (const [i, id] of ids.entries()) {
      const precise = i === 0 ? '2026-09-01T10:00:00.123100Z' : '2026-09-01T10:00:00.123200Z';
      await db.insert(listings).values({
        id,
        createdByUserId: owner.id,
        kind: 'found',
        title: 'Report ' + i,
        description: 'Found backpack',
        location: 'Berlin',
        occurredOn: i === 2 ? '2026-08-30' : '2026-09-01',
        createdAt: sql`${precise}::timestamptz`,
      });
    }
    const resolved = await report(owner.id);
    await db.update(listings).set({ status: 'resolved' }).where(eq(listings.id, resolved.id));
    const archived = await report(owner.id);
    await db.update(listings).set({ status: 'archived' }).where(eq(listings.id, archived.id));
    const lost = await report(owner.id);
    await db.update(listings).set({ kind: 'lost' }).where(eq(listings.id, lost.id));

    for (const [sort, expected] of Object.entries({
      newest: [ids[2], ids[1], ids[0]],
      oldest: ids,
      occurredOnDesc: [ids[1], ids[0], ids[2]],
      occurredOnAsc: [ids[2], ids[0], ids[1]],
    })) {
      let cursor: string | null = null;
      const received: string[] = [];
      for (let page = 0; page < 5; page++) {
        const query = new URLSearchParams({ kind: 'found', sort, limit: '1' });
        if (cursor) query.set('cursor', cursor);
        const response = await request('/listings?' + query, owner.cookie);
        expect(response.status).toBe(200);
        const body = (await response.json()) as ListingListResponse;
        received.push(...body.listings.map((item) => item.id));
        cursor = body.pageInfo.endCursor;
        if (!body.pageInfo.hasNextPage) break;
      }
      expect(received).toEqual([...expected]);
    }
    const lostFeed = await request('/listings?kind=lost', owner.cookie);
    expect(
      ((await lostFeed.json()) as ListingListResponse).listings.map((item) => item.id),
    ).toEqual([lost.id]);
    const allFeed = await request('/listings', owner.cookie);
    expect(allFeed.status).toBe(200);
    const all = (await allFeed.json()) as ListingListResponse;
    expect(all.listings.map((item) => item.id).sort()).toEqual([...ids, lost.id].sort());
  });
});

describe('claims regressions', () => {
  test('rejects one claim without closing the report or deciding its competitors', async () => {
    const owner = await user('finder');
    const first = await user('first');
    const second = await user('second');
    const listing = await report(owner.id);
    const a = await submit(listing.id, first.cookie);
    const b = await submit(listing.id, second.cookie);
    const rejection = await request(
      '/claims/' + a.id,
      owner.cookie,
      { decision: 'rejected' },
      'PATCH',
    );
    expect(rejection.status).toBe(200);
    const detail = await request('/listings/' + listing.id, first.cookie);
    const body = (await detail.json()) as ListingDetailResponse;
    expect(body.listing.status).toBe('active');
    expect(body.claim?.status).toBe('rejected');
    expect(body.claim?.handoverDetails).toBeNull();
    expect(body.capabilities.canClaim).toBe(false);
    const [competitor] = await db.select().from(claims).where(eq(claims.id, b.id));
    expect(competitor?.status).toBe('pending');
    const duplicate = await request('/listings/' + listing.id + '/claims', first.cookie, {
      verificationDetails: 'Trying to claim this item again.',
    });
    expect(duplicate.status).toBe(409);
  });

  test('concurrent approvals terminate with exactly one winner', async () => {
    const owner = await user('finder');
    const first = await user('first');
    const second = await user('second');
    const listing = await report(owner.id);
    const a = await submit(listing.id, first.cookie);
    const b = await submit(listing.id, second.cookie);
    const responses = await Promise.all(
      [a, b].map((claim) =>
        request(
          '/claims/' + claim.id,
          owner.cookie,
          { decision: 'approved', handoverDetails: 'Collect from library reception after 10am.' },
          'PATCH',
        ),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const stored = await db.select().from(claims).where(eq(claims.listingId, listing.id));
    expect(stored.filter((claim) => claim.status === 'approved')).toHaveLength(1);
    expect(stored.filter((claim) => claim.status === 'pending')).toHaveLength(0);
  }, 10000);

  test('serializes duplicate submissions and approval versus creation', async () => {
    const owner = await user('finder');
    const first = await user('first');
    const second = await user('second');
    const listing = await report(owner.id);
    const responses = await Promise.all(
      [1, 2].map(() =>
        request('/listings/' + listing.id + '/claims', first.cookie, {
          verificationDetails: 'Private proof: red notebook inside.',
        }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const [existing] = await db.select().from(claims).where(eq(claims.listingId, listing.id));
    const [approval, creation] = await Promise.all([
      request(
        '/claims/' + existing!.id,
        owner.cookie,
        { decision: 'approved', handoverDetails: 'Collect from the library reception.' },
        'PATCH',
      ),
      request('/listings/' + listing.id + '/claims', second.cookie, {
        verificationDetails: 'Private proof: blue notebook inside.',
      }),
    ]);
    expect(approval.status).toBe(200);
    expect([201, 409]).toContain(creation.status);
    const pending = await db
      .select()
      .from(claims)
      .where(and(eq(claims.listingId, listing.id), eq(claims.status, 'pending')));
    expect(pending).toHaveLength(0);
  }, 10000);

  test('keeps resolved claims accessible and handover details private', async () => {
    const owner = await user('finder');
    const claimant = await user('claimant');
    const stranger = await user('stranger');
    const listing = await report(owner.id);
    const claim = await submit(listing.id, claimant.cookie);
    expect(
      (await request('/claims/' + claim.id, stranger.cookie, { decision: 'rejected' }, 'PATCH'))
        .status,
    ).toBe(403);
    const approval = await request(
      '/claims/' + claim.id,
      owner.cookie,
      {
        decision: 'approved',
        handoverDetails: '  Private handover: reception desk code 123.  ',
      },
      'PATCH',
    );
    expect(approval.status).toBe(200);
    const detail = await request('/listings/' + listing.id, claimant.cookie);
    expect(detail.headers.get('cache-control')).toContain('no-store');
    const body = (await detail.json()) as ListingDetailResponse;
    expect(body.listing.status).toBe('resolved');
    expect(body.claim?.handoverDetails).toBe('Private handover: reception desk code 123.');
    const publicDetail = await request('/listings/' + listing.id, stranger.cookie);
    expect(await publicDetail.text()).not.toContain('Private handover');
    expect((await request('/listings/' + listing.id + '/claims', claimant.cookie)).status).toBe(
      403,
    );

    const activity = await request('/me/claims', claimant.cookie);
    expect(activity.status).toBe(200);
    const history = (await activity.json()) as ClaimActivityResponse;
    const direct = await listClaimActivity(claimant.id, 'outgoing', {});
    expect(direct.ok && direct.value.claims.map((item) => item.id)).toEqual([claim.id]);
    expect(history).toMatchObject({ claims: [{ id: claim.id, status: 'approved' }] });
    expect(history.claims[0]?.status).toBe('approved');
    expect(history.claims[0]?.listing.id).toBe(listing.id);
    expect(JSON.stringify(history)).not.toContain('Private');
    const unrelated = await request('/me/claims?direction=incoming', stranger.cookie);
    expect(((await unrelated.json()) as ClaimActivityResponse).claims).toHaveLength(0);
    const mine = await request('/me/listings', owner.cookie);
    expect(((await mine.json()) as ListingListResponse).listings[0]?.status).toBe('resolved');
    const strangersReports = await request('/me/listings', stranger.cookie);
    expect(((await strangersReports.json()) as ListingListResponse).listings).toHaveLength(0);
  });

  test('paginates incoming claims and rejects cursors from another report', async () => {
    const owner = await user('finder');
    const a = await user('first');
    const b = await user('second');
    const listing = await report(owner.id);
    const first = await submit(listing.id, a.cookie);
    const second = await submit(listing.id, b.cookie);
    const response = await request('/listings/' + listing.id + '/claims?limit=1', owner.cookie);
    const page = (await response.json()) as IncomingClaimsResponse;
    expect(page.claims.map((claim) => claim.id)).toEqual([second.id]);
    const next = await request(
      '/listings/' + listing.id + '/claims?limit=1&cursor=' + page.pageInfo.endCursor,
      owner.cookie,
    );
    expect(((await next.json()) as IncomingClaimsResponse).claims.map((claim) => claim.id)).toEqual(
      [first.id],
    );
    const another = await report(owner.id);
    expect(
      (
        await request(
          '/listings/' + another.id + '/claims?cursor=' + page.pageInfo.endCursor,
          owner.cookie,
        )
      ).status,
    ).toBe(400);
  });
});
