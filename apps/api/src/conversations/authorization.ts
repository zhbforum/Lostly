import { and, eq, or } from 'drizzle-orm';
import { db, type DatabaseTransaction } from '@/db';
import { claimConversations, claimConversationMembers } from '@/db/conversations';
import { claims, listings } from '@/db/schema';
import { canSendConversationMessages } from '@/domain/conversation';

export async function findConversationForMember(
  conversationId: string,
  userId: string,
  executor: typeof db | DatabaseTransaction = db,
) {
  const [conversation] = await executor
    .select({
      id: claimConversations.id,
      claimId: claims.id,
      listingId: listings.id,
      claimantUserId: claims.claimantUserId,
      ownerUserId: listings.createdByUserId,
      claimStatus: claims.status,
      listingStatus: listings.status,
      createdAt: claimConversations.createdAt,
      lastMessageAt: claimConversations.lastMessageAt,
      lastReadSequence: claimConversationMembers.lastReadSequence,
    })
    .from(claimConversations)
    .innerJoin(
      claimConversationMembers,
      eq(claimConversationMembers.conversationId, claimConversations.id),
    )
    .innerJoin(claims, eq(claims.id, claimConversations.claimId))
    .innerJoin(listings, eq(listings.id, claims.listingId))
    .where(
      and(
        eq(claimConversations.id, conversationId),
        eq(claimConversationMembers.userId, userId),
        eq(listings.isHidden, false),
        or(eq(claims.claimantUserId, userId), eq(listings.createdByUserId, userId)),
      ),
    )
    .limit(1);
  return conversation
    ? { ...conversation, canSendMessages: canSendConversationMessages(conversation.claimStatus) }
    : null;
}
