import { eq } from 'drizzle-orm';
import type { DatabaseTransaction } from '@/db';
import { claims, moderationCases, moderationEvents } from '@/db/schema';
import { listingImages } from '@/db/listing-images';
import { ModerationError } from './errors';

export async function assertCaseScope(
  tx: DatabaseTransaction,
  record: typeof moderationCases.$inferSelect,
  target: { targetType: string; targetId: string; action: string; parentEventId?: string },
) {
  const { targetType, targetId } = target;
  if (targetType === 'case' && targetId === record.id) return;
  if (record.targetType === targetType && record.targetId === targetId) return;
  if (
    targetType === 'user' &&
    (record.context.userId === targetId ||
      (record.targetType === 'avatar' && record.targetId === targetId))
  )
    return;
  if (targetType === 'listing' && record.context.listingId === targetId) return;
  if (targetType === 'conversation' && record.context.conversationId === targetId) return;
  if (targetType === 'claim' && record.context.claimId === targetId) return;
  if (
    record.targetType === 'listing' &&
    (targetType === 'listing_image' || targetType === 'claim')
  ) {
    const table = targetType === 'listing_image' ? listingImages : claims;
    const [child] = await tx
      .select({ listingId: table.listingId })
      .from(table)
      .where(eq(table.id, targetId));
    if (child?.listingId === record.targetId) return;
  }
  // Cascading archive decisions and their reversals must belong to the same audited root.
  if (
    targetType === 'claim' &&
    target.parentEventId &&
    ['reject_claim', 'reopen_claim'].includes(target.action)
  ) {
    const [parent] = await tx
      .select()
      .from(moderationEvents)
      .where(eq(moderationEvents.id, target.parentEventId));
    const [claim] = await tx.select().from(claims).where(eq(claims.id, targetId));
    if (parent && claim) {
      if (
        target.action === 'reject_claim' &&
        parent.action === 'archive_listing' &&
        parent.caseId === record.id &&
        parent.targetId === claim.listingId
      )
        return;
      if (
        target.action === 'reopen_claim' &&
        parent.action === 'reject_claim' &&
        parent.targetId === targetId &&
        record.kind === 'appeal'
      ) {
        const [appealed] = record.parentEventId
          ? await tx
              .select()
              .from(moderationEvents)
              .where(eq(moderationEvents.id, record.parentEventId))
          : [];
        const rootId = parent.parentEventId ?? parent.id;
        if (appealed && (appealed.parentEventId ?? appealed.id) === rootId) return;
      }
    }
  }
  throw new ModerationError(
    403,
    'CASE_SCOPE_MISMATCH',
    'This action does not belong to the selected case.',
  );
}
