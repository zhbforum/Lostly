import type { DatabaseTransaction } from '@/db';
import { claimConversations, claimConversationMembers } from '@/db/conversations';

export async function createClaimConversation(
  tx: DatabaseTransaction,
  claim: { id: string; claimantUserId: string },
  ownerUserId: string,
) {
  if (claim.claimantUserId === ownerUserId) throw new Error('Claim participants must be distinct');
  const [conversation] = await tx
    .insert(claimConversations)
    .values({ claimId: claim.id })
    .returning();
  if (!conversation) throw new Error('Failed to create claim conversation');
  await tx.insert(claimConversationMembers).values([
    { conversationId: conversation.id, userId: claim.claimantUserId },
    { conversationId: conversation.id, userId: ownerUserId },
  ]);
  return conversation;
}
