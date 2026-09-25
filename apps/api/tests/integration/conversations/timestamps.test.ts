import { afterAll, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { listings } from '@/db/schema';
import { claimConversations, claimMessages } from '@/db/conversations';
import { sendClaimMessage } from '@/conversations/send';
import { timestampCursorValue } from '@/pagination/cursor';
import { clearDatabase, conversationFixture } from './fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

async function activity(messageId: string) {
  const [row] = await db
    .select({
      messageTime: timestampCursorValue(claimMessages.createdAt),
      activityTime: timestampCursorValue(claimConversations.lastMessageAt),
      identical: sql<boolean>`${claimMessages.createdAt} = ${claimConversations.lastMessageAt}`,
    })
    .from(claimMessages)
    .innerJoin(claimConversations, eq(claimConversations.id, claimMessages.conversationId))
    .where(eq(claimMessages.id, messageId));
  if (!row) throw new Error('Missing message activity');
  expect(row.identical).toBe(true);
  expect(row.activityTime).toBe(row.messageTime);
  expect(row.messageTime).toMatch(/\.\d{6}Z$/);
  return row;
}

test.each(['listing', 'conversation'] as const)(
  'message time follows actual acquisition of the %s lock, not transaction start',
  async (kind) => {
    const { conversation, listing, owner } = await conversationFixture();
    let pending: ReturnType<typeof sendClaimMessage> | undefined;
    let barrier: string | undefined;
    try {
      await db.transaction(async (tx) => {
        const [holder] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        if (kind === 'listing')
          await tx.select().from(listings).where(eq(listings.id, listing.id)).for('update');
        else
          await tx
            .select()
            .from(claimConversations)
            .where(eq(claimConversations.id, conversation.id))
            .for('update');
        pending = sendClaimMessage({
          conversationId: conversation.id,
          userId: owner.id,
          clientOperationId: crypto.randomUUID(),
          body: 'Waited for lock',
        });
        const deadline = performance.now() + 3000;
        let waiting = false;
        while (performance.now() < deadline) {
          const rows = await db.execute<{ query: string }>(sql`select query from pg_stat_activity
          where ${holder!.pid}::integer = any(pg_blocking_pids(pid)) and wait_event_type = 'Lock'`);
          if (rows.length) {
            expect(rows[0]!.query.toLowerCase()).toContain('for update');
            expect(rows[0]!.query).toContain(
              kind === 'listing' ? 'listings' : 'claim_conversations',
            );
            waiting = true;
            break;
          }
          await Bun.sleep(5);
        }
        expect(waiting).toBe(true);
        const [marker] = await tx.execute<{ at: string }>(
          sql`select ${timestampCursorValue(sql`clock_timestamp()`)} as at`,
        );
        barrier = marker!.at;
      });
      const result = await pending;
      if (!result?.ok) throw new Error('Expected send after lock release');
      const stored = await activity(result.value.message.id);
      const [checked] = await db.execute<{ afterWait: boolean }>(
        sql`select ${stored.messageTime}::timestamptz >= ${barrier}::timestamptz as "afterWait"`,
      );
      expect(checked!.afterWait).toBe(true);
    } finally {
      if (pending) await Promise.allSettled([pending]);
    }
  },
);

test('application clock skew cannot set message activity and replay preserves the stored timestamp', async () => {
  const { conversation, owner } = await conversationFixture();
  const input = {
    conversationId: conversation.id,
    userId: owner.id,
    clientOperationId: crypto.randomUUID(),
    body: 'DB clock',
  };
  const [start] = await db.execute<{ at: string }>(
    sql`select ${timestampCursorValue(sql`clock_timestamp()`)} as at`,
  );
  let result: Awaited<ReturnType<typeof sendClaimMessage>>;
  setSystemTime(new Date('2000-01-01T00:00:00Z'));
  try {
    result = await sendClaimMessage(input);
  } finally {
    setSystemTime();
  }
  if (!result.ok) throw new Error('Expected send with skewed clock');
  const stored = await activity(result.value.message.id);
  const [check] = await db.execute<{ valid: boolean }>(sql`select ${stored.messageTime}::timestamptz
    between ${start!.at}::timestamptz and clock_timestamp() as valid`);
  expect(check!.valid).toBe(true);
  expect(await sendClaimMessage(input)).toEqual({
    ok: true,
    value: { created: false, message: result.value.message },
  });
  expect(await activity(result.value.message.id)).toEqual(stored);
});
