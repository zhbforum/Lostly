import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { ClaimResponse } from '@lostly/contracts/claims';
import type { ListingResponse } from '@lostly/contracts/listings';
import { db } from '@/db';
import { claims, listings, moderationEvents, users } from '@/db/schema';
import { runInListingLockOrder as runInLockOrder } from '@tests/support/listing-lock-order';
import {
  claim,
  clearDatabase,
  editableInput,
  report,
  request,
  updateInput,
  user,
} from './management-fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

describe('deterministic listing/claim concurrency', () => {
  for (const other of ['edit', 'create', 'approve'] as const) {
    test.each([true, false])(
      `hide vs ${other}, hide first: %s`,
      async (hideFirst) => {
        const owner = await user('owner');
        const actor = await user('admin');
        await db.update(users).set({ role: 'admin' }).where(eq(users.id, actor.id));
        const claimant = await user('claimant');
        const newcomer = await user('newcomer');
        const listing = await report(owner.id);
        const pending = await claim(listing.id, claimant.id);
        const hide = () =>
          request(`/admin/listings/${listing.id}/hide`, actor.cookie, {
            expectedVersion: 1,
            reason: 'Unsafe report',
          });
        const competing = () =>
          other === 'edit'
            ? request('/listings/' + listing.id, owner.cookie, updateInput, 'PATCH')
            : other === 'create'
              ? request(`/listings/${listing.id}/claims`, newcomer.cookie, {
                  verificationDetails: 'Private ownership evidence',
                })
              : request(
                  '/claims/' + pending.id,
                  owner.cookie,
                  { decision: 'approved', handoverDetails: 'Collect from the library desk.' },
                  'PATCH',
                );
        const { responses } = await runInLockOrder(
          hideFirst ? hide : competing,
          hideFirst ? competing : hide,
        );
        const hiding = responses[hideFirst ? 0 : 1]!;
        const competition = responses[hideFirst ? 1 : 0]!;
        expect(hiding.status).toBe(hideFirst || other === 'create' ? 204 : 409);
        expect(competition.status).toBe(hideFirst ? 404 : other === 'create' ? 201 : 200);
        const [stored] = await db.select().from(listings).where(eq(listings.id, listing.id));
        expect(stored?.isHidden).toBe(hideFirst || other === 'create');
        expect(stored?.version).toBe(2);
        const [storedClaim] = await db.select().from(claims).where(eq(claims.id, pending.id));
        expect(storedClaim?.status).toBe(
          !hideFirst && other === 'approve' ? 'approved' : 'pending',
        );
        const events = await db
          .select()
          .from(moderationEvents)
          .where(eq(moderationEvents.targetId, listing.id));
        expect(events).toHaveLength(hideFirst || other === 'create' ? 1 : 0);
      },
      15000,
    );
  }
  test('checks the editor version after waiting for a competing edit to commit', async () => {
    const owner = await user('owner');
    const listing = await report(owner.id);
    const input = {
      title: listing.title,
      description: listing.description,
      location: listing.location,
      occurredOn: listing.occurredOn,
      expectedVersion: listing.version,
    };
    const {
      responses: [first, second],
    } = await runInLockOrder(
      () =>
        request(
          '/listings/' + listing.id,
          owner.cookie,
          { ...input, title: 'First tab title' },
          'PATCH',
        ),
      () =>
        request(
          '/listings/' + listing.id,
          owner.cookie,
          { ...input, description: 'Second tab description' },
          'PATCH',
        ),
    );
    expect(first!.status).toBe(200);
    expect(second!.status).toBe(409);
    expect(await second!.json()).toMatchObject({ error: { code: 'LISTING_VERSION_CONFLICT' } });
    const saved = (await first!.json()) as ListingResponse;
    const [stored] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(stored).toEqual({
      ...listing,
      title: 'First tab title',
      version: listing.version + 1,
      updatedAt: new Date(saved.listing.updatedAt),
    });
    expect(saved).toMatchObject({
      listing: {
        title: stored!.title,
        version: stored!.version,
      },
    });
  }, 15000);

  for (const close of ['resolve', 'archive'] as const) {
    for (const other of ['edit', 'create', 'approve'] as const) {
      test.each([
        { order: 'closing first', closeFirst: true },
        { order: 'competing first', closeFirst: false },
      ])(
        `${close} vs ${other}: $order`,
        async ({ closeFirst }) => {
          const owner = await user('owner');
          const claimant = await user('claimant');
          const newcomer = await user('newcomer');
          const listing = await report(owner.id);
          const pending = await claim(listing.id, claimant.id);
          const rejected = await claim(
            listing.id,
            (await user('rejected')).id,
            'rejected',
            owner.id,
          );
          const closing = () =>
            request(`/listings/${listing.id}/${close}`, owner.cookie, undefined, 'POST');
          const competing = () =>
            other === 'edit'
              ? request('/listings/' + listing.id, owner.cookie, updateInput, 'PATCH')
              : other === 'create'
                ? request(`/listings/${listing.id}/claims`, newcomer.cookie, {
                    verificationDetails: 'Private proof from new claimant.',
                  })
                : request(
                    '/claims/' + pending.id,
                    owner.cookie,
                    { decision: 'approved', handoverDetails: 'Collect from library reception.' },
                    'PATCH',
                  );

          const { responses, releasedAt } = await runInLockOrder(
            closeFirst ? closing : competing,
            closeFirst ? competing : closing,
          );
          const closingResponse = responses[closeFirst ? 0 : 1]!;
          const competingResponse = responses[closeFirst ? 1 : 0]!;
          expect(closingResponse.status).toBe(
            !closeFirst && other === 'approve' && close === 'resolve' ? 409 : 200,
          );
          expect(competingResponse.status).toBe(closeFirst ? 409 : other === 'create' ? 201 : 200);
          const [stored] = await db.select().from(listings).where(eq(listings.id, listing.id));
          expect(stored!.status).toBe(close === 'archive' ? 'archived' : 'resolved');
          expect(stored!.version).toBe(
            listing.version +
              Number(closingResponse.status === 200) +
              Number(!closeFirst && other !== 'create'),
          );
          expect(stored!.updatedAt.getTime()).toBeGreaterThanOrEqual(releasedAt.getTime());
          expect(stored!.title).toBe(
            !closeFirst && other === 'edit' ? editableInput.title : listing.title,
          );

          const rows = await db.select().from(claims).where(eq(claims.listingId, listing.id));
          expect(rows.some((row) => row.status === 'pending')).toBe(false);
          expect(rows.find((row) => row.id === rejected.id)).toEqual(rejected);
          const decided = rows.find((row) => row.id === pending.id)!;
          expect(decided.status).toBe(!closeFirst && other === 'approve' ? 'approved' : 'rejected');
          expect(decided.reviewedByUserId).toBe(owner.id);
          expect(decided.reviewedAt).toEqual(decided.updatedAt);
          expect(decided.updatedAt.getTime()).toBeGreaterThanOrEqual(releasedAt.getTime());
          expect(decided.verificationDetails).toBe(pending.verificationDetails);
          expect(decided.createdAt).toEqual(pending.createdAt);
          if (!closeFirst && other === 'approve') {
            const approvedBody = (await competingResponse.json()) as ClaimResponse;
            expect(decided.handoverDetails).toBe('Collect from library reception.');
            expect(decided.updatedAt.toISOString()).toBe(approvedBody.claim.updatedAt);
            expect(approvedBody.claim.reviewedAt).toBe(decided.reviewedAt!.toISOString());
          } else {
            expect(decided.handoverDetails).toBeNull();
            expect(decided.updatedAt).toEqual(stored!.updatedAt);
          }
          const created = rows.find((row) => row.claimantUserId === newcomer.id);
          if (other === 'create' && !closeFirst) {
            expect(created).toMatchObject({
              status: 'rejected',
              reviewedByUserId: owner.id,
              reviewedAt: stored!.updatedAt,
              updatedAt: stored!.updatedAt,
            });
          } else {
            expect(created).toBeUndefined();
          }
        },
        15000,
      );
    }
  }
});
