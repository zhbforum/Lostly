import { and, eq, sql } from 'drizzle-orm';
import type { ReadConversationResponse } from '@lostly/contracts/conversations';
import { db } from '@/db';
import { claimConversationMembers, claimMessages } from '@/db/conversations';
import { lockListing } from '@/listings/locking';
import { findConversationForMember } from './authorization';
import type { ConversationResult } from './selection';
import { unreadMessageCount } from './unread';

export async function readConversation(input: {
  conversationId: string;
  userId: string;
  messageId: string;
}): Promise<
  ConversationResult<ReadConversationResponse, 'conversation-not-found' | 'message-not-found'>
> {
  return db.transaction(async (tx) => {
    const reference = await findConversationForMember(input.conversationId, input.userId, tx);
    if (!reference) return { ok: false, reason: 'conversation-not-found' };
    const listing = await lockListing(tx, reference.listingId);
    if (!listing || listing.isHidden) return { ok: false, reason: 'conversation-not-found' };
    const access = await findConversationForMember(input.conversationId, input.userId, tx);
    if (!access) return { ok: false, reason: 'conversation-not-found' };
    const [message] = await tx
      .select({ sequence: claimMessages.sequence })
      .from(claimMessages)
      .where(
        and(
          eq(claimMessages.conversationId, input.conversationId),
          eq(claimMessages.id, input.messageId),
        ),
      )
      .limit(1);
    if (!message) return { ok: false, reason: 'message-not-found' };
    const [state] = await tx
      .update(claimConversationMembers)
      .set({
        lastReadSequence: sql`greatest(${claimConversationMembers.lastReadSequence}, ${message.sequence})`,
      })
      .where(
        and(
          eq(claimConversationMembers.conversationId, input.conversationId),
          eq(claimConversationMembers.userId, input.userId),
        ),
      )
      .returning({
        lastReadSequence: claimConversationMembers.lastReadSequence,
        unreadCount: unreadMessageCount(input.userId),
      });
    if (!state) return { ok: false, reason: 'conversation-not-found' };
    return { ok: true, value: state };
  });
}
