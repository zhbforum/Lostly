import { eq } from 'drizzle-orm';
import type { ModerationAction } from '@lostly/contracts/moderation';
import type { DatabaseTransaction } from '@/db';
import { moderationCases, moderationEvents, moderationNotifications } from '@/db/schema';
import { conflict, ModerationError, notFound } from './errors';

export interface ModerationCommand {
  reason: string;
  publicReason?: string;
  caseId?: string;
  expectedVersion?: number;
}
export async function checkCase(tx: DatabaseTransaction, caseId: string, actorUserId: string) {
  const [record] = await tx
    .select()
    .from(moderationCases)
    .where(eq(moderationCases.id, caseId))
    .for('update');
  if (!record) notFound();
  if (record.status === 'resolved' || record.status === 'dismissed') conflict();
  if (record.assigneeId && record.assigneeId !== actorUserId)
    throw new ModerationError(
      403,
      'CASE_ASSIGNED',
      'This case is assigned to another administrator.',
    );
  return record;
}

export async function audit(
  tx: DatabaseTransaction,
  input: {
    actorUserId: string;
    targetType: string;
    targetId: string;
    action: ModerationAction;
    reason: string;
    caseId?: string | null;
    parentEventId?: string;
    metadata?: Record<string, unknown>;
    createdAt?: Date;
  },
) {
  if (input.caseId) await checkCase(tx, input.caseId, input.actorUserId);
  const [event] = await tx.insert(moderationEvents).values(input).returning();
  if (!event) throw new Error('Missing moderation event');
  return event;
}

export async function notify(
  tx: DatabaseTransaction,
  event: typeof moderationEvents.$inferSelect,
  input: {
    userId: string;
    title: string;
    message: string;
    canAppeal?: boolean;
  },
) {
  await tx
    .insert(moderationNotifications)
    .values({
      ...input,
      eventId: event.id,
      targetType: event.targetType,
      targetId: event.targetId,
    })
    .onConflictDoNothing();
}
