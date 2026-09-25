import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { claimConversations, claimMessages } from '@/db/conversations';
import { createClaim } from '@/claims/create';
import { report } from './fixtures';

export async function room(ownerId: string, claimantId: string) {
  const listing = await report(ownerId);
  const result = await createClaim({
    listingId: listing.id,
    claimantUserId: claimantId,
    verificationDetails: 'Private proof for ' + listing.id,
  });
  if (!result.ok) throw new Error('Expected fixture claim');
  return { listing, claim: result.value, id: result.value.conversationId };
}

export async function seedMessages(conversationId: string, senders: string[]) {
  if (!senders.length) return [];
  return db.transaction(async (tx) => {
    const messages = await tx
      .insert(claimMessages)
      .values(
        senders.map((senderUserId, index) => ({
          conversationId,
          sequence: index + 1,
          senderUserId,
          clientOperationId: crypto.randomUUID(),
          body: `Message ${index + 1}`,
          createdAt: new Date('2026-09-01T12:00:00.000Z'),
        })),
      )
      .returning();
    await tx
      .update(claimConversations)
      .set({
        nextMessageSequence: messages.length + 1,
        lastMessageAt: sql`(select ${claimMessages.createdAt} from ${claimMessages}
        where ${claimMessages.conversationId} = ${conversationId}::uuid
        order by ${claimMessages.sequence} desc limit 1)`,
      })
      .where(eq(claimConversations.id, conversationId));
    return messages;
  });
}
