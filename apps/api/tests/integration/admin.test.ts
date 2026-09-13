import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { AdminClaim, AdminListing, AdminPage, AdminUser } from '@lostly/contracts/admin';
import { app } from '@/app';
import { db } from '@/db';
import { claims, listings, moderationEvents, users } from '@/db/schema';
import { claim, clearDatabase, report, request, user } from './listings/management-fixtures';

async function clear() {
  await db.delete(moderationEvents);
  await clearDatabase();
}
beforeEach(clear);
afterAll(clear);

async function admin() {
  const actor = await user('admin');
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, actor.id));
  return actor;
}

describe('admin moderation', () => {
  test('protects every endpoint and rechecks the role of an existing session', async () => {
    const ordinary = await user('ordinary');
    const actor = await admin();
    const listing = await report(ordinary.id);
    const pending = await claim(listing.id, actor.id);
    const paths: [string, unknown?][] = [
      ['/admin/overview'],
      ['/admin/listings'],
      ['/admin/users'],
      ['/admin/claims'],
      [`/admin/listings/${listing.id}/archive`, { reason: 'Spam report', expectedVersion: 1 }],
      [`/admin/claims/${pending.id}/reject`, { reason: 'Spam claim' }],
    ];
    for (const [path, body] of paths) {
      expect((await request(path, undefined, body)).status).toBe(401);
      expect((await request(path, ordinary.cookie, body)).status).toBe(403);
    }
    expect((await request('/admin/overview', actor.cookie)).status).toBe(200);
    await db.update(users).set({ role: 'user' }).where(eq(users.id, actor.id));
    expect((await request('/admin/overview', actor.cookie)).status).toBe(403);
    expect(await db.select().from(moderationEvents)).toEqual([]);
    expect((await db.select().from(listings))[0]?.status).toBe('active');
  });

  test('returns counts and bounded, deterministic pages without private fields', async () => {
    const actor = await admin();
    const owner = await user('owner');
    const first = await report(owner.id);
    const second = await report(owner.id, 'lost', 'archived');
    await claim(first.id, actor.id);
    expect(await (await request('/admin/overview', actor.cookie)).json()).toEqual({
      users: 2,
      listings: 2,
      activeListings: 1,
      pendingClaims: 1,
    });
    const response = await request('/admin/listings?limit=1', actor.cookie);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const page = (await response.json()) as AdminPage<AdminListing>;
    expect(page.items).toHaveLength(1);
    expect(page.pageInfo.hasNextPage).toBe(true);
    const next = (await (
      await request('/admin/listings?limit=1&cursor=' + page.pageInfo.endCursor, actor.cookie)
    ).json()) as AdminPage<AdminListing>;
    expect(new Set([...page.items, ...next.items].map((row) => row.id))).toEqual(
      new Set([first.id, second.id]),
    );
    expect(next.pageInfo.hasNextPage).toBe(false);
    expect(
      (await request('/admin/claims?cursor=' + page.pageInfo.endCursor, actor.cookie)).status,
    ).toBe(400);
    for (const suffix of ['?limit=0', '?limit=51', '?limit=1.5'])
      expect((await request('/admin/users' + suffix, actor.cookie)).status).toBe(422);
    expect((await request('/admin/users?cursor=invalid', actor.cookie)).status).toBe(400);
    const accounts = (await (
      await request('/admin/users', actor.cookie)
    ).json()) as AdminPage<AdminUser>;
    expect(accounts.items).toHaveLength(2);
    expect(JSON.stringify(accounts)).not.toContain('passwordHash');
    const summaries = (await (
      await request('/admin/claims', actor.cookie)
    ).json()) as AdminPage<AdminClaim>;
    expect(summaries.items[0]?.claimant.id).toBe(actor.id);
    expect(JSON.stringify(summaries)).not.toMatch(
      /verificationDetails|handoverDetails|Private proof/,
    );
  });

  test('archives atomically, closes pending claims and logs the real actor and reason', async () => {
    const actor = await admin();
    const owner = await user('owner');
    const listing = await report(owner.id);
    const pending = await claim(listing.id, actor.id);
    const path = `/admin/listings/${listing.id}/archive`;
    expect(
      (await request(path, actor.cookie, { expectedVersion: 2, reason: 'Spam report' })).status,
    ).toBe(409);
    expect(await db.select().from(moderationEvents)).toEqual([]);
    const response = await request(path, actor.cookie, {
      expectedVersion: 1,
      reason: '  Spam report  ',
      actorUserId: owner.id,
    });
    expect(response.status).toBe(204);
    const [stored] = await db.select().from(listings);
    const [reviewed] = await db.select().from(claims);
    const [event] = await db.select().from(moderationEvents);
    expect(stored).toMatchObject({ status: 'archived', version: 2 });
    expect(reviewed).toMatchObject({
      id: pending.id,
      status: 'rejected',
      reviewedByUserId: actor.id,
      reviewedAt: stored!.updatedAt,
    });
    expect(event).toMatchObject({
      action: 'archive_listing',
      targetId: listing.id,
      actorUserId: actor.id,
      reason: 'Spam report',
      createdAt: stored!.updatedAt,
    });
    expect(
      (await request(path, actor.cookie, { expectedVersion: 2, reason: 'Spam report' })).status,
    ).toBe(409);
    expect(await db.select().from(moderationEvents)).toHaveLength(1);
    expect(await (await request('/listings', owner.cookie)).json()).toMatchObject({ listings: [] });
  });

  test('rejects only pending claims and preserves completed handover history', async () => {
    const actor = await admin();
    const owner = await user('owner');
    const listing = await report(owner.id);
    const pending = await claim(listing.id, actor.id);
    const path = `/admin/claims/${pending.id}/reject`;
    expect((await request(path, actor.cookie, { reason: 'Spam claim' })).status).toBe(204);
    expect((await request(path, actor.cookie, { reason: 'Spam claim' })).status).toBe(409);
    expect((await db.select().from(claims))[0]).toMatchObject({
      status: 'rejected',
      reviewedByUserId: actor.id,
    });
    expect((await db.select().from(listings))[0]).toMatchObject({ status: 'active', version: 1 });
    expect((await db.select().from(moderationEvents))[0]).toMatchObject({
      action: 'reject_claim',
      targetId: pending.id,
      actorUserId: actor.id,
    });
    const resolved = await report(owner.id, 'found', 'resolved');
    const approved = await claim(resolved.id, actor.id, 'approved', owner.id);
    expect(
      (
        await request(`/admin/claims/${approved.id}/reject`, actor.cookie, {
          reason: 'Cannot reject',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/admin/listings/${resolved.id}/archive`, actor.cookie, {
          expectedVersion: 1,
          reason: 'Archive old report',
        })
      ).status,
    ).toBe(204);
    expect((await db.select().from(claims).where(eq(claims.id, approved.id)))[0]).toEqual(approved);
  });

  test('validates moderation input and requires CSRF protection', async () => {
    const actor = await admin();
    const listing = await report(actor.id);
    const path = `/admin/listings/${listing.id}/archive`;
    for (const reason of ['', '  ', 'x'.repeat(501), null, 12])
      expect((await request(path, actor.cookie, { expectedVersion: 1, reason })).status).toBe(422);
    expect((await request(path, actor.cookie, { reason: 'Missing version' })).status).toBe(422);
    expect(
      (
        await request('/admin/listings/invalid/archive', actor.cookie, {
          expectedVersion: 1,
          reason: 'Invalid ID',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(`/admin/listings/${crypto.randomUUID()}/archive`, actor.cookie, {
          expectedVersion: 1,
          reason: 'Missing report',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(`/admin/claims/${crypto.randomUUID()}/reject`, actor.cookie, {
          reason: 'Missing claim',
        })
      ).status,
    ).toBe(404);
    const response = await app.handle(
      new Request('http://localhost' + path, {
        method: 'POST',
        headers: { Cookie: actor.cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Spam report', expectedVersion: 1 }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await db.select().from(moderationEvents)).toEqual([]);
  });

  test('serializes competing archive requests without duplicate audit events', async () => {
    const actor = await admin();
    const listing = await report((await user('owner')).id);
    await claim(listing.id, actor.id);
    const command = () =>
      request(`/admin/listings/${listing.id}/archive`, actor.cookie, {
        expectedVersion: 1,
        reason: 'Duplicate report',
      });
    const responses = await Promise.all([command(), command()]);
    expect(responses.map((response) => response.status).sort()).toEqual([204, 409]);
    expect(await db.select().from(moderationEvents)).toHaveLength(1);
    expect((await db.select().from(listings))[0]?.version).toBe(2);
  });
});
