import { eq } from 'drizzle-orm';
import type { ModerationAction } from '@lostly/contracts/moderation';
import type { DatabaseTransaction } from '@/db';
import {
  moderationCases,
  moderationEvents,
  moderationNotifications,
  type EvidencePayload,
} from '@/db/schema';
import { assertCaseScope } from './case-scope';
import { decisionEvidence, retainEvidence } from './evidence';
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
    evidence?: EvidencePayload;
  },
) {
  if (input.caseId)
    await assertCaseScope(tx, await checkCase(tx, input.caseId, input.actorUserId), input);
  const { evidence, ...values } = input;
  const appealable = [
    'archive_listing',
    'reject_claim',
    'hide_listing',
    'suspend_user',
    'reset_profile',
    'hide_listing_image',
    'hide_message',
    'close_conversation',
  ].includes(input.action);
  const evidenceId = appealable
    ? await retainEvidence(
        tx,
        evidence ?? (await decisionEvidence(tx, input.targetType, input.targetId)),
      )
    : null;
  const [event] = await tx
    .insert(moderationEvents)
    .values({ ...values, evidenceId })
    .returning();
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
