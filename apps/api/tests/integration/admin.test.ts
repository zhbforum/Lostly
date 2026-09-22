import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { AdminClaim, AdminListing, AdminPage, AdminUser } from '@lostly/contracts/admin';
import { app } from '@/app';
import { setListingVisibility } from '@/admin/service';
import { db } from '@/db';
import { claims, listings, moderationEvents, users } from '@/db/schema';
import {
  claim,
  clearDatabase,
  report,
  request,
  updateInput,
  user,
} from './listings/management-fixtures';

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
  test('rolls back visibility and version if its audit event cannot be saved', async () => {
    const actor = await admin();
    const original = await report(actor.id);
    await expect(
      setListingVisibility(original.id, actor.id, 'hide', {
        expectedVersion: 1,
        reason: 'x'.repeat(501),
      }),
    ).rejects.toThrow();
    expect((await db.select().from(listings))[0]).toEqual(original);
    expect(await db.select().from(moderationEvents)).toEqual([]);
  });
  test('combines search and filters and binds cursors to the current query', async () => {
    const actor = await admin();
    const owner = await user('Finder');
    const first = await report(owner.id);
    const second = await report(owner.id);
    await report(owner.id, 'lost');
    await report(owner.id, 'found', 'archived');
    const page = (await (
      await request('/admin/listings?q=BACKPACK&kind=found&status=active&limit=1', actor.cookie)
    ).json()) as AdminPage<AdminListing>;
    expect(page.items).toHaveLength(1);
    const cursor = page.pageInfo.endCursor!;
    const next = (await (
      await request(
        '/admin/listings?q=backpack&kind=found&status=active&limit=1&cursor=' + cursor,
        actor.cookie,
      )
    ).json()) as AdminPage<AdminListing>;
    expect(new Set([...page.items, ...next.items].map((row) => row.id))).toEqual(
      new Set([first.id, second.id]),
    );
    for (const query of [
      'q=Berlin&kind=found&status=active',
      'q=backpack&kind=lost&status=active',
      'q=backpack&kind=found&status=archived',
      'q=backpack&kind=found&status=active&visibility=hidden',
    ])
      expect(
        (await request('/admin/listings?' + query + '&cursor=' + cursor, actor.cookie)).status,
      ).toBe(400);
    for (const q of ['FINDER', 'finder@example.com']) {
      const matches = (await (
        await request('/admin/users?q=' + encodeURIComponent(q), actor.cookie)
      ).json()) as AdminPage<AdminUser>;
      expect(matches.items.map((row) => row.id)).toEqual([owner.id]);
    }
    const pending = await claim(first.id, actor.id);
    await claim(second.id, actor.id, 'rejected', owner.id);
    const matches = (await (
      await request('/admin/claims?status=pending&q=backpack', actor.cookie)
    ).json()) as AdminPage<AdminClaim>;
    expect(matches.items.map((row) => row.id)).toEqual([pending.id]);
    expect(JSON.stringify(matches)).not.toMatch(/verificationDetails|handoverDetails/);
  });

  test('treats search wildcards literally and rejects invalid or misplaced filters', async () => {
    const actor = await admin();
    const listing = await report(actor.id);
    await db
      .update(listings)
      .set({ title: '100%_backpack\\label' })
      .where(eq(listings.id, listing.id));
    await report(actor.id);
    for (const q of ['%', '_', '\\']) {
      const page = (await (
        await request('/admin/listings?q=' + encodeURIComponent(q), actor.cookie)
      ).json()) as AdminPage<AdminListing>;
      expect(page.items.map((row) => row.id)).toEqual([listing.id]);
    }
    for (const path of [
      '/admin/users?status=active',
      '/admin/users?kind=lost',
      '/admin/claims?kind=found',
      '/admin/listings?status=pending',
      '/admin/claims?status=active',
      '/admin/users?visibility=hidden',
      '/admin/listings?visibility=invalid',
      '/admin/listings?kind=invalid',
      '/admin/users?q=' + 'x'.repeat(101),
    ])
      expect((await request(path, actor.cookie)).status).toBe(422);
  });

  test.each(['active', 'resolved', 'archived'] as const)(
    'hides and restores %s listings without changing lifecycle or claim history',
    async (status) => {
      const actor = await admin();
      const owner = await user('owner');
      const claimant = await user('claimant');
      const original = await report(owner.id, 'found', status);
      const existing = await claim(
        original.id,
        claimant.id,
        status === 'active' ? 'pending' : 'approved',
        status === 'active' ? undefined : owner.id,
      );
      const path = '/admin/listings/' + original.id;
      expect(
        (
          await request(path + '/hide', actor.cookie, {
            expectedVersion: 1,
            reason: '  Unsafe report  ',
          })
        ).status,
      ).toBe(204);
      expect((await db.select().from(listings))[0]).toMatchObject({
        isHidden: true,
        status,
        version: 2,
      });
      expect((await db.select().from(claims))[0]).toEqual(existing);
      for (const session of [owner, claimant, actor]) {
        expect((await request('/listings/' + original.id, session.cookie)).status).toBe(404);
        expect((await request('/listings/' + original.id + '/claims', session.cookie)).status).toBe(
          404,
        );
        for (const endpoint of [
          '/listings',
          '/me/listings',
          '/me/claims',
          '/me/claims?direction=incoming',
        ]) {
          const response = await request(endpoint, session.cookie);
          expect(response.status).toBe(200);
          expect(await response.text()).not.toContain(original.id);
        }
      }
      expect(
        (await request('/listings/' + original.id, owner.cookie, updateInput, 'PATCH')).status,
      ).toBe(404);
      for (const action of ['resolve', 'archive'])
        expect(
          (
            await request(
              '/listings/' + original.id + '/' + action,
              owner.cookie,
              undefined,
              'POST',
            )
          ).status,
        ).toBe(404);
      expect(
        (
          await request('/listings/' + original.id + '/claims', claimant.cookie, {
            verificationDetails: 'Private ownership evidence',
          })
        ).status,
      ).toBe(404);
      expect(
        (await request('/claims/' + existing.id, owner.cookie, { decision: 'rejected' }, 'PATCH'))
          .status,
      ).toBe(404);
      const hidden = (await (
        await request('/admin/listings?visibility=hidden', actor.cookie)
      ).json()) as AdminPage<AdminListing>;
      expect(hidden.items.map((row) => row.id)).toEqual([original.id]);
      expect(
        await (await request('/admin/listings?visibility=visible', actor.cookie)).json(),
      ).toMatchObject({ items: [] });
      expect(
        (
          await request(path + '/restore', actor.cookie, {
            expectedVersion: 2,
            reason: 'Reviewed and allowed',
          })
        ).status,
      ).toBe(204);
      expect((await db.select().from(listings))[0]).toMatchObject({
        isHidden: false,
        status,
        version: 3,
      });
      expect((await db.select().from(claims))[0]).toEqual(existing);
      expect((await request('/listings/' + original.id, claimant.cookie)).status).toBe(200);
      const feed = (await (await request('/listings', owner.cookie)).json()) as {
        listings: { id: string }[];
      };
      expect(feed.listings.some((row) => row.id === original.id)).toBe(status === 'active');
      const events = await db.select().from(moderationEvents);
      expect(events).toHaveLength(2);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'hide_listing',
            targetId: original.id,
            actorUserId: actor.id,
            reason: 'Unsafe report',
          }),
          expect.objectContaining({
            action: 'restore_listing',
            targetId: original.id,
            actorUserId: actor.id,
            reason: 'Reviewed and allowed',
          }),
        ]),
      );
    },
  );

  test('protects visibility actions, validates input and refuses stale or repeated transitions', async () => {
    const actor = await admin();
    const owner = await user('owner');
    const listing = await report(owner.id);
    const input = { expectedVersion: 1, reason: 'Moderator decision' };
    for (const action of ['hide', 'restore']) {
      const path = `/admin/listings/${listing.id}/${action}`;
      expect((await request(path, undefined, input)).status).toBe(401);
      expect((await request(path, owner.cookie, input)).status).toBe(403);
      expect((await request(path, actor.cookie, { ...input, reason: '  ' })).status).toBe(422);
      expect((await request(path, actor.cookie, { reason: input.reason })).status).toBe(422);
      expect(
        (await request(`/admin/listings/${crypto.randomUUID()}/${action}`, actor.cookie, input))
          .status,
      ).toBe(404);
      const csrf = await app.handle(
        new Request('http://localhost' + path, {
          method: 'POST',
          headers: { cookie: actor.cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      expect(csrf.status).toBe(403);
    }
    const path = '/admin/listings/' + listing.id;
    expect((await request(path + '/restore', actor.cookie, input)).status).toBe(409);
    expect(
      (await request(path + '/hide', actor.cookie, { ...input, expectedVersion: 2 })).status,
    ).toBe(409);
    expect(await db.select().from(moderationEvents)).toEqual([]);
    expect((await request(path + '/hide', actor.cookie, input)).status).toBe(204);
    expect(
      (await request(path + '/hide', actor.cookie, { ...input, expectedVersion: 2 })).status,
    ).toBe(409);
    expect((await request(path + '/restore', actor.cookie, input)).status).toBe(409);
    expect(await db.select().from(moderationEvents)).toHaveLength(1);
  });
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
