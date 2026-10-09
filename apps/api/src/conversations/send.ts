import { eq, sql } from 'drizzle-orm';
import { CONVERSATION_IMAGE_CONSTRAINTS } from '@lostly/contracts/conversations';
import { db } from '@/db';
import { claimConversations, claimMessages, claimMessageAttachments } from '@/db/conversations';
import { normalizeMessageBody } from '@/domain/conversation';
import { lockListing } from '@/listings/locking';
import { findConversationForMember } from './authorization';
import { messageSelection, type ConversationResult, type MessageRecord } from './selection';
import { conversationSendRateLimit } from './rate-limit';
import {
  findMessageOperation,
  sameMessageFingerprint,
  type MessageOperation,
  type MessageFingerprint,
} from './replay';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PreparedAttachment = Omit<
  typeof claimMessageAttachments.$inferInsert,
  'messageId' | 'id'
>;
export class MessageCommitUnknownError extends Error {
  constructor(cause: unknown) {
    super('Message commit outcome is unknown', { cause });
  }
}

export async function sendClaimMessage(
  input: {
    conversationId: string;
    userId: string;
    clientOperationId: string;
    body: string;
  },
  consumeQuota = conversationSendRateLimit,
): Promise<ConversationResult<{ message: MessageRecord; created: boolean }>> {
  const normalized = normalizeMessageBody(input.body);
  if (normalized.status !== 'text') return { ok: false, reason: 'invalid-message' };
  return commitClaimMessage(
    { ...input, body: normalized.body, sourceHashes: [], attachments: [] },
    consumeQuota,
  );
}

export async function commitClaimMessage(
  input: MessageOperation & MessageFingerprint & { attachments: PreparedAttachment[] },
  consumeQuota = conversationSendRateLimit,
): Promise<ConversationResult<{ message: MessageRecord; created: boolean }>> {
  if (!UUID.test(input.clientOperationId)) return { ok: false, reason: 'invalid-operation-id' };
  if (
    (input.body === null && !input.attachments.length) ||
    input.attachments.length > CONVERSATION_IMAGE_CONSTRAINTS.maxCount ||
    input.sourceHashes.length !== input.attachments.length ||
    input.attachments.some(
      (row, index) => row.position !== index || row.sourceHash !== input.sourceHashes[index],
    )
  )
    return { ok: false, reason: 'invalid-message' };
  let ownWritesCompleted = false;
  try {
    return await db.transaction(async (tx) => {
      const reference = await findConversationForMember(input.conversationId, input.userId, tx);
      if (!reference) return { ok: false, reason: 'conversation-not-found' };

      const listing = await lockListing(tx, reference.listingId);
      if (!listing || listing.isHidden) return { ok: false, reason: 'conversation-not-found' };
      const access = await findConversationForMember(input.conversationId, input.userId, tx);
      if (!access) return { ok: false, reason: 'conversation-not-found' };

      const [conversation] = await tx
        .select()
        .from(claimConversations)
        .where(eq(claimConversations.id, input.conversationId))
        .for('update')
        .limit(1);
      if (!conversation) return { ok: false, reason: 'conversation-not-found' };
      const previous = await findMessageOperation(input, tx);
      if (previous) {
        if (!sameMessageFingerprint(previous, input))
          return { ok: false, reason: 'idempotency-conflict' };
        return { ok: true, value: { message: previous.message, created: false } };
      }
      if (!access.canSendMessages) return { ok: false, reason: 'conversation-read-only' };

      // The process-local attempt budget is intentionally not refunded if the DB transaction later rolls back.
      const retryAfterSeconds = consumeQuota(conversation.id, input.userId);
      if (retryAfterSeconds !== null)
        return { ok: false, reason: 'rate-limited', retryAfterSeconds };

      const [message] = await tx
        .insert(claimMessages)
        .values({
          conversationId: conversation.id,
          sequence: conversation.nextMessageSequence,
          senderUserId: input.userId,
          clientOperationId: input.clientOperationId,
          body: input.body,
          createdAt: sql`clock_timestamp()`,
        })
        .returning(messageSelection);
      if (!message) throw new Error('Failed to create claim message');
      if (input.attachments.length)
        await tx
          .insert(claimMessageAttachments)
          .values(input.attachments.map((row) => ({ ...row, messageId: message.id })));
      await tx
        .update(claimConversations)
        .set({
          nextMessageSequence: conversation.nextMessageSequence + 1,
          lastMessageAt: sql`(select ${claimMessages.createdAt} from ${claimMessages}
          where ${claimMessages.id} = ${message.id}::uuid)`,
        })
        .where(eq(claimConversations.id, conversation.id));
      const success = { ok: true, value: { message, created: true } } as const;
      ownWritesCompleted = true;
      return success;
    });
  } catch (error) {
    if (ownWritesCompleted) throw new MessageCommitUnknownError(error);
    throw error;
  }
}
