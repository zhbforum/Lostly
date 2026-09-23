import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { claimConversations } from '@/db/conversations';
import { createClaim } from '@/claims/create';
import { report, user } from '../listings/management-fixtures';

export { clearDatabase, report, user } from '../listings/management-fixtures';

export async function conversationFixture() {
  const owner = await user('conversation-owner');
  const claimant = await user('conversation-claimant');
  const listing = await report(owner.id);
  const result = await createClaim({
    listingId: listing.id,
    claimantUserId: claimant.id,
    verificationDetails: 'Private proof: red notebook inside.',
  });
  if (!result.ok) throw new Error('Failed to create fixture claim');
  const [conversation] = await db
    .select()
    .from(claimConversations)
    .where(eq(claimConversations.claimId, result.value.id));
  if (!conversation) throw new Error('Missing fixture conversation');
  return { owner, claimant, listing, claim: result.value, conversation };
}
