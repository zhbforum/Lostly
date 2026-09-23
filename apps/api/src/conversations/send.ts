import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { claimConversations, claimMessages } from '@/db/conversations';
import { normalizeMessageBody } from '@/domain/conversation';
import { lockListing } from '@/listings/locking';
import { findConversationForMember } from './authorization';
import { messageSelection, type ConversationResult, type MessageRecord } from './selection';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function sendClaimMessage(input: {
  conversationId: string;
  userId: string;
  clientOperationId: string;
  body: string;
}): Promise<ConversationResult<{ message: MessageRecord; created: boolean }>> {
  return db.transaction(async (tx) => {
    const reference = await findConversationForMember(input.conversationId, input.userId, tx);
    if (!reference) return { ok: false, reason: 'conversation-not-found' };

    const body = normalizeMessageBody(input.body);
    if (body === null) return { ok: false, reason: 'invalid-message' };
    if (!UUID.test(input.clientOperationId)) return { ok: false, reason: 'invalid-operation-id' };

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
    const [previous] = await tx
      .select(messageSelection)
      .from(claimMessages)
      .where(
        and(
          eq(claimMessages.conversationId, input.conversationId),
          eq(claimMessages.senderUserId, input.userId),
          eq(claimMessages.clientOperationId, input.clientOperationId),
        ),
      )
      .limit(1);
    if (previous) {
      if (previous.body !== body) return { ok: false, reason: 'idempotency-conflict' };
      return { ok: true, value: { message: previous, created: false } };
    }
    if (!access.canSendMessages) return { ok: false, reason: 'conversation-read-only' };

    const now = new Date();
    const [message] = await tx
      .insert(claimMessages)
      .values({
        conversationId: conversation.id,
        sequence: conversation.nextMessageSequence,
        senderUserId: input.userId,
        clientOperationId: input.clientOperationId,
        body,
        createdAt: now,
      })
      .returning(messageSelection);
    if (!message) throw new Error('Failed to create claim message');
    await tx
      .update(claimConversations)
      .set({
        nextMessageSequence: conversation.nextMessageSequence + 1,
        lastMessageAt: now,
      })
      .where(eq(claimConversations.id, conversation.id));
    return { ok: true, value: { message, created: true } };
  });
}
