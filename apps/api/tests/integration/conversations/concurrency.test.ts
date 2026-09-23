import { afterAll, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { claims, users } from '@/db/schema';
import { claimMessages, claimConversations } from '@/db/conversations';
import { createClaim } from '@/claims/create';
import { decideClaim } from '@/claims/decide';
import { sendClaimMessage } from '@/conversations/send';
import { archiveOwnedListing, resolveOwnedListing } from '@/listings/management';
import { setListingVisibility } from '@/admin/service';
import { runInListingLockOrder } from '@tests/support/listing-lock-order';
import { clearDatabase, conversationFixture, user } from './fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

for (const operation of [
  'reject',
  'approve-other',
  'approve-self',
  'archive-pending',
  'archive-approved',
  'resolve',
  'hide',
] as const) {
  test.each([false, true])(
    `send versus ${operation}, other operation first: %s`,
    async (otherFirst) => {
      const { owner, claimant, listing, claim, conversation } = await conversationFixture();
      let moderatorId = owner.id;
      if (operation === 'hide') {
        const moderator = await user('moderator');
        await db.update(users).set({ role: 'admin' }).where(eq(users.id, moderator.id));
        moderatorId = moderator.id;
      }
      let targetClaimId = claim.id;
      if (operation === 'approve-other') {
        const competitor = await user('competitor');
        const other = await createClaim({
          listingId: listing.id,
          claimantUserId: competitor.id,
          verificationDetails: 'Competing proof.',
        });
        if (!other.ok) throw new Error('Missing competing claim');
        targetClaimId = other.value.id;
      }
      if (operation === 'archive-approved') {
        expect(
          await decideClaim({
            claimId: claim.id,
            reviewerUserId: owner.id,
            decision: 'approved',
            handoverDetails: 'Meet at the entrance.',
          }),
        ).toMatchObject({ ok: true });
      }
      const remainsWritable = operation === 'approve-self' || operation === 'archive-approved';
      const shouldSend = !otherFirst || remainsWritable;
      const send = async () => {
        const result = await sendClaimMessage({
          conversationId: conversation.id,
          userId: claimant.id,
          clientOperationId: crypto.randomUUID(),
          body: 'Message racing with ' + operation,
        });
        if (shouldSend)
          expect(result).toMatchObject({
            ok: true,
            value: { created: true, message: { sequence: 1 } },
          });
        else
          expect(result).toEqual({
            ok: false,
            reason: operation === 'hide' ? 'conversation-not-found' : 'conversation-read-only',
          });
      };
      const other = async () => {
        if (operation === 'hide') {
          expect(
            await setListingVisibility(listing.id, moderatorId, 'hide', {
              expectedVersion: 1,
              reason: 'Moderation race fixture',
            }),
          ).toBe('ok');
        } else if (
          operation === 'reject' ||
          operation === 'approve-other' ||
          operation === 'approve-self'
        ) {
          const decision =
            operation === 'reject'
              ? { decision: 'rejected' as const }
              : { decision: 'approved' as const, handoverDetails: 'Meet at the entrance.' };
          expect(
            await decideClaim({ claimId: targetClaimId, reviewerUserId: owner.id, ...decision }),
          ).toMatchObject({ ok: true });
        } else {
          const close = operation === 'resolve' ? resolveOwnedListing : archiveOwnedListing;
          expect(await close({ listingId: listing.id, ownerUserId: owner.id })).toMatchObject({
            ok: true,
          });
        }
      };
      const { releasedAt } = await runInListingLockOrder(
        otherFirst ? other : send,
        otherFirst ? send : other,
      );
      const messages = await db.select().from(claimMessages);
      expect(messages).toHaveLength(shouldSend ? 1 : 0);
      if (shouldSend)
        expect(messages[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(releasedAt.getTime());
      const [stored] = await db
        .select()
        .from(claimConversations)
        .where(eq(claimConversations.id, conversation.id));
      expect(stored!.nextMessageSequence).toBe(shouldSend ? 2 : 1);
      const [decided] = await db.select().from(claims).where(eq(claims.id, claim.id));
      expect(decided!.status).toBe(
        operation === 'hide' ? 'pending' : remainsWritable ? 'approved' : 'rejected',
      );
    },
    15000,
  );
}
