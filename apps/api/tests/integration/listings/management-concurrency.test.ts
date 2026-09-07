import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import type { ClaimResponse } from '@lostly/contracts/claims';
import type { ListingResponse } from '@lostly/contracts/listings';
import { db } from '@/db';
import { claims, listings } from '@/db/schema';
import * as locking from '@/listings/locking';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out waiting for lock test synchronization')),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function assertWaitingForListingLock(waiter: number, holder: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await db.execute<{ blocked: boolean; query: string }>(sql`
      select ${holder}::int = any(pg_blocking_pids(pid)) as blocked, query
      from pg_stat_activity where pid = ${waiter} and wait_event_type = 'Lock'
    `);
    if (rows[0]?.blocked) {
      expect(rows[0].query.toLowerCase()).toContain('for update');
      expect(rows[0].query).toContain('listings');
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error(
    'Second mutation did not demonstrably wait for the first listing FOR UPDATE lock',
  );
}

// Only pause the real lock helper in tests. Both mutations still execute their
// production transactions and SQL. PostgreSQL itself proves who blocks whom.
async function runInLockOrder(first: () => Promise<Response>, second: () => Promise<Response>) {
  const lockListing = locking.lockListing;
  const acquired = deferred<number>();
  const attempting = deferred<number>();
  const release = deferred<void>();
  let calls = 0;
  let secondAcquired = false;
  const spy = spyOn(locking, 'lockListing').mockImplementation(async (tx, id) => {
    const order = calls++;
    await tx.execute(sql`set local lock_timeout = '8s'`);
    const rows = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    if (order === 1) attempting.resolve(rows[0]!.pid);
    const listing = await lockListing(tx, id);
    if (order === 0) {
      acquired.resolve(rows[0]!.pid);
      await within(release.promise);
    } else {
      secondAcquired = true;
    }
    return listing;
  });
  const firstRequest = first();
  let secondRequest: Promise<Response> | undefined;
  try {
    const holder = await within(acquired.promise);
    secondRequest = second();
    const waiter = await within(attempting.promise);
    expect(waiter).not.toBe(holder);
    await assertWaitingForListingLock(waiter, holder);
    expect(secondAcquired).toBe(false);
    const releasedAt = new Date();
    release.resolve();
    const responses = await within(Promise.all([firstRequest, secondRequest]));
    expect(secondAcquired).toBe(true);
    expect(calls).toBe(2);
    return { responses, releasedAt };
  } finally {
    release.resolve();
    await Promise.allSettled([firstRequest, ...(secondRequest ? [secondRequest] : [])]);
    spy.mockRestore();
  }
}

describe('deterministic listing/claim concurrency', () => {
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
