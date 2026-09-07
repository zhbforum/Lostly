import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { ListingDetailResponse, ListingResponse } from '@lostly/contracts/listings';
import { db } from '@/db';
import { claims, listings } from '@/db/schema';
import {
  claim,
  clearDatabase,
  editableInput,
  fixtureTime,
  report,
  request,
  updateInput,
  user,
} from './management-fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

async function storedListing(id: string) {
  return (await db.select().from(listings).where(eq(listings.id, id)))[0]!;
}

describe('owner edit', () => {
  test.each(['lost', 'found'] as const)(
    'edits active %s and trims all text fields',
    async (kind) => {
      const owner = await user('owner');
      const original = await report(owner.id, kind);
      const response = await request(
        '/listings/' + original.id,
        owner.cookie,
        {
          ...updateInput,
          title: '  Updated backpack  ',
          description: '  Updated description  ',
          location: ' Updated location ',
        },
        'PATCH',
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ listing: editableInput });
      const stored = await storedListing(original.id);
      expect(stored).toMatchObject({
        ...editableInput,
        kind,
        status: 'active',
        createdByUserId: owner.id,
        createdAt: original.createdAt,
      });
      expect(stored.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
      expect(stored.version).toBe(original.version + 1);
    },
  );

  test.each([
    'kind',
    'status',
    'createdByUserId',
    'id',
    'version',
    'createdAt',
    'updatedAt',
    'unknown',
  ])('rejects extra %s with 422 and leaves the entire record unchanged', async (field) => {
    const owner = await user('owner');
    const original = await report(owner.id);
    const response = await request(
      '/listings/' + original.id,
      owner.cookie,
      { ...updateInput, [field]: field === 'status' ? 'archived' : 'unexpected' },
      'PATCH',
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Request fields are invalid' },
    });
    expect(await storedListing(original.id)).toEqual(original);
  });

  test.each([
    { title: '' },
    { title: 'x'.repeat(121) },
    { description: '  ' },
    { description: 'x'.repeat(2001) },
    { location: 'a' },
    { location: 'x'.repeat(161) },
    { occurredOn: '2026-02-30' },
    { title: null },
  ])('invalid fields do not change the record: %j', async (invalid) => {
    const owner = await user('owner');
    const original = await report(owner.id);
    expect(
      (
        await request(
          '/listings/' + original.id,
          owner.cookie,
          { ...updateInput, ...invalid },
          'PATCH',
        )
      ).status,
    ).toBe(422);
    expect(await storedListing(original.id)).toEqual(original);
  });

  test('requires the complete editable payload', async () => {
    const owner = await user('owner');
    const original = await report(owner.id);
    for (const key of Object.keys(updateInput)) {
      const body = { ...updateInput } as Record<string, string | number>;
      delete body[key];
      expect((await request('/listings/' + original.id, owner.cookie, body, 'PATCH')).status).toBe(
        422,
      );
      expect(await storedListing(original.id)).toEqual(original);
    }
  });

  test('rejects a stale editor without overwriting the first save and accepts the current version', async () => {
    const owner = await user('owner');
    const original = await report(owner.id);
    const path = '/listings/' + original.id;
    const { listing } = (await (await request(path, owner.cookie)).json()) as ListingDetailResponse;
    expect(listing.version).toBe(1);
    const input = {
      title: listing.title,
      description: listing.description,
      location: listing.location,
      occurredOn: listing.occurredOn,
      expectedVersion: listing.version,
    };
    const first = await request(
      path,
      owner.cookie,
      { ...input, title: 'First tab title' },
      'PATCH',
    );
    expect(first.status).toBe(200);
    const saved = (await first.json()) as ListingResponse;
    expect(saved.listing.version).toBe(listing.version + 1);
    const stored = await storedListing(listing.id);

    const second = await request(
      path,
      owner.cookie,
      { ...input, description: 'Second tab description' },
      'PATCH',
    );
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: 'LISTING_VERSION_CONFLICT' } });
    expect(await storedListing(listing.id)).toEqual(stored);
    expect(stored.title).toBe('First tab title');
    expect(stored.description).toBe(listing.description);

    const retry = await request(
      path,
      owner.cookie,
      {
        ...input,
        title: saved.listing.title,
        description: 'Second tab description',
        expectedVersion: saved.listing.version,
      },
      'PATCH',
    );
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      listing: {
        title: 'First tab title',
        description: 'Second tab description',
        version: saved.listing.version + 1,
      },
    });
  });
});

describe('owner authorization and transitions', () => {
  for (const action of ['edit', 'resolve', 'archive'] as const) {
    const command = (id: string, cookie?: string) =>
      request(
        '/listings/' + id + (action === 'edit' ? '' : '/' + action),
        cookie,
        action === 'edit' ? updateInput : undefined,
        action === 'edit' ? 'PATCH' : 'POST',
      );
    test(`${action}: authenticates and authorizes the owner without changes`, async () => {
      const owner = await user('owner');
      const other = await user('other');
      const original = await report(owner.id);
      expect((await command(original.id)).status).toBe(401);
      const forbidden = await command(original.id, other.cookie);
      expect(forbidden.status).toBe(403);
      expect(await forbidden.json()).toMatchObject({
        error: { code: `LISTING_${action === 'edit' ? 'UPDATE' : action.toUpperCase()}_FORBIDDEN` },
      });
      expect(await storedListing(original.id)).toEqual(original);
      expect((await command(crypto.randomUUID(), owner.cookie)).status).toBe(404);
      expect((await command('invalid', owner.cookie)).status).toBe(422);
    });
    test.each(['resolved', 'archived'] as const)(`${action}: %s state`, async (status) => {
      const owner = await user('owner');
      const original = await report(owner.id, 'found', status);
      const response = await command(original.id, owner.cookie);
      if (action === 'archive' && status === 'resolved') {
        expect(response.status).toBe(200);
        expect((await storedListing(original.id)).status).toBe('archived');
      } else {
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          error: {
            code:
              action === 'edit'
                ? 'LISTING_NOT_EDITABLE'
                : action === 'resolve'
                  ? 'LISTING_NOT_RESOLVABLE'
                  : 'LISTING_ALREADY_ARCHIVED',
          },
        });
        expect(await storedListing(original.id)).toEqual(original);
      }
    });
  }

  for (const action of ['resolve', 'archive'] as const) {
    test.each(['lost', 'found'] as const)(
      `${action}: closes active %s and preserves discovery/history access`,
      async (kind) => {
        const owner = await user('owner');
        const viewer = await user('viewer');
        const original = await report(owner.id, kind);
        expect(
          (await request(`/listings/${original.id}/${action}`, owner.cookie, undefined, 'POST'))
            .status,
        ).toBe(200);
        const stored = await storedListing(original.id);
        expect(stored.status).toBe(action === 'resolve' ? 'resolved' : 'archived');
        expect(stored.version).toBe(original.version + 1);
        expect(stored.updatedAt.getTime()).toBeGreaterThan(fixtureTime.getTime());
        expect(await (await request('/listings', viewer.cookie)).json()).toMatchObject({
          listings: [],
        });
        expect(await (await request('/me/listings', owner.cookie)).json()).toMatchObject({
          listings: [{ id: original.id, status: stored.status }],
        });
        expect((await request('/listings/' + original.id, viewer.cookie)).status).toBe(200);
      },
    );

    test(`${action}: closes only pending claims with matching actor and timestamps`, async () => {
      const owner = await user('owner');
      const original = await report(owner.id);
      const pending = await claim(original.id, (await user('pending')).id);
      const second = await claim(original.id, (await user('second')).id);
      const rejected = await claim(original.id, (await user('rejected')).id, 'rejected', owner.id);
      expect(
        (await request(`/listings/${original.id}/${action}`, owner.cookie, undefined, 'POST'))
          .status,
      ).toBe(200);
      const stored = await storedListing(original.id);
      const rows = await db.select().from(claims).where(eq(claims.listingId, original.id));
      for (const initial of [pending, second]) {
        expect(rows.find((row) => row.id === initial.id)).toEqual({
          ...initial,
          status: 'rejected',
          reviewedByUserId: owner.id,
          reviewedAt: stored.updatedAt,
          updatedAt: stored.updatedAt,
        });
      }
      expect(rows.find((row) => row.id === rejected.id)).toEqual(rejected);
      expect(
        await (await request(`/listings/${original.id}/claims`, owner.cookie)).json(),
      ).toMatchObject({
        claims: expect.arrayContaining([
          expect.objectContaining({
            id: pending.id,
            status: 'rejected',
            verificationDetails: pending.verificationDetails,
          }),
        ]),
      });
    });
  }

  test('archiving a resolved report preserves all completed claim data including handover', async () => {
    const owner = await user('owner');
    const original = await report(owner.id, 'found', 'resolved');
    const approved = await claim(original.id, (await user('approved')).id, 'approved', owner.id);
    const rejected = await claim(original.id, (await user('rejected')).id, 'rejected', owner.id);
    expect(
      (await request(`/listings/${original.id}/archive`, owner.cookie, undefined, 'POST')).status,
    ).toBe(200);
    expect(await db.select().from(claims).where(eq(claims.listingId, original.id))).toEqual(
      expect.arrayContaining([approved, rejected]),
    );
  });

  test.each(['lost', 'found'] as const)(
    'capabilities follow owner and status for %s reports',
    async (kind) => {
      const owner = await user('owner');
      const other = await user('other');
      for (const status of ['active', 'resolved', 'archived'] as const) {
        const listing = await report(owner.id, kind, status);
        const own = (await (
          await request('/listings/' + listing.id, owner.cookie)
        ).json()) as ListingDetailResponse;
        expect(own.capabilities).toEqual({
          canClaim: false,
          canReviewClaims: kind === 'found',
          canEdit: status === 'active',
          canResolve: status === 'active',
          canArchive: status !== 'archived',
        });
        const view = (await (
          await request('/listings/' + listing.id, other.cookie)
        ).json()) as ListingDetailResponse;
        expect(view.capabilities).toEqual({
          canClaim: kind === 'found' && status === 'active',
          canReviewClaims: false,
          canEdit: false,
          canResolve: false,
          canArchive: false,
        });
        if (kind === 'found' && status === 'active') {
          await claim(listing.id, other.id);
          expect(
            await (await request('/listings/' + listing.id, other.cookie)).json(),
          ).toMatchObject({ capabilities: { canClaim: false } });
        }
      }
    },
  );
});
