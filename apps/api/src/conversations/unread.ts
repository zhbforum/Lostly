import { and, eq, gt, ne, sql } from 'drizzle-orm';
import { claimConversationMembers, claimMessages } from '@/db/conversations';

export function unreadMessagePredicate(userId: string) {
  return and(
    eq(claimMessages.conversationId, claimConversationMembers.conversationId),
    gt(claimMessages.sequence, claimConversationMembers.lastReadSequence),
    ne(claimMessages.senderUserId, userId),
  );
}

export function unreadMessageCount(userId: string) {
  return sql<number>`(select count(*) from ${claimMessages}
    where ${unreadMessagePredicate(userId)})`.mapWith(Number);
}
