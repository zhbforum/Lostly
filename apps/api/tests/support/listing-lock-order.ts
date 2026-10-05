import { expect, spyOn } from 'bun:test';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import * as locking from '@/listings/locking';

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

async function assertWaitingForListingLock(
  waiter: number,
  holder: number,
  strength: 'update' | 'share',
) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await db.execute<{ blocked: boolean; query: string }>(sql`
      select ${holder}::int = any(pg_blocking_pids(pid)) as blocked, query
      from pg_stat_activity where pid = ${waiter} and wait_event_type = 'Lock'
    `);
    if (rows[0]?.blocked) {
      expect(rows[0].query.toLowerCase()).toContain(`for ${strength}`);
      expect(rows[0].query).toContain('listings');
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error('Second operation did not demonstrably wait for the first listing lock');
}

// Only pause the real lock helper in tests. Both operations still execute their
// production transactions and SQL. PostgreSQL itself proves who blocks whom.
export async function runInListingLockOrder<A, B>(
  first: () => Promise<A>,
  second: () => Promise<B>,
) {
  const lockListing = locking.lockListing;
  const acquired = deferred<number>();
  const attempting = deferred<number>();
  const release = deferred<void>();
  let calls = 0;
  let secondAcquired = false;
  let secondStrength: 'update' | 'share' = 'update';
  const spy = spyOn(locking, 'lockListing').mockImplementation(
    async (tx, id, strength = 'update') => {
      const order = calls++;
      await tx.execute(sql`set local lock_timeout = '8s'`);
      const rows = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      if (order === 1) {
        secondStrength = strength;
        attempting.resolve(rows[0]!.pid);
      }
      const listing = await lockListing(tx, id, strength);
      if (order === 0) {
        acquired.resolve(rows[0]!.pid);
        await within(release.promise);
      } else {
        secondAcquired = true;
      }
      return listing;
    },
  );
  const firstRequest = first();
  let secondRequest: Promise<B> | undefined;
  try {
    const holder = await within(acquired.promise);
    secondRequest = second();
    const waiter = await within(attempting.promise);
    expect(waiter).not.toBe(holder);
    await assertWaitingForListingLock(waiter, holder, secondStrength);
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
