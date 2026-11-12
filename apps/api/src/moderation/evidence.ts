import { eq } from 'drizzle-orm';
import type { DatabaseTransaction } from '@/db';
import { claims, listings, moderationEvidence, users, type EvidencePayload } from '@/db/schema';
import { listingImages } from '@/db/listing-images';
import { claimConversations, claimMessageAttachments, claimMessages } from '@/db/conversations';
import { avatarKeys } from '@/profile/queries';
import type { ObjectStorage } from '@/storage/object-storage';
import { ModerationError, notFound } from './errors';

export const EVIDENCE_RETENTION_MS = 90 * 86_400_000;

export function evidenceContext(payload: EvidencePayload) {
  return {
    listingId: payload.listingId,
    userId: payload.userId,
    conversationId: payload.conversationId,
    claimId: payload.claimId,
  };
}

export function profileEvidence(
  person: typeof users.$inferSelect,
  fields: readonly string[] = ['displayName', 'username', 'bio', 'avatar'],
): EvidencePayload {
  return {
    userId: person.id,
    text: [
      fields.includes('displayName') ? person.displayName : null,
      fields.includes('username') ? person.username : null,
      fields.includes('bio') ? person.bio : null,
    ]
      .filter((value) => value != null)
      .join('\n'),
    images:
      fields.includes('avatar') && person.avatarId
        ? [
            {
              id: person.avatarId,
              objectKey: avatarKeys(person.id, person.avatarId, person.avatarAnimated).image,
              width: 256,
              height: 256,
            },
          ]
        : [],
  };
}

// Callers hold the target's listing/account lock through snapshot and decision commit.
export async function decisionEvidence(
  tx: DatabaseTransaction,
  targetType: string,
  targetId: string,
): Promise<EvidencePayload> {
  if (targetType === 'user') {
    const [person] = await tx.select().from(users).where(eq(users.id, targetId));
    if (!person) notFound();
    return profileEvidence(person);
  }
  if (targetType === 'claim') {
    const [claim] = await tx.select().from(claims).where(eq(claims.id, targetId));
    if (!claim) notFound();
    return {
      text: claim.verificationDetails,
      claimId: claim.id,
      listingId: claim.listingId,
      userId: claim.claimantUserId,
    };
  }
  if (targetType === 'message' || targetType === 'conversation') {
    const [message] =
      targetType === 'message'
        ? await tx.select().from(claimMessages).where(eq(claimMessages.id, targetId))
        : [];
    const [context] = await tx
      .select({
        conversationId: claimConversations.id,
        claimId: claims.id,
        listingId: claims.listingId,
      })
      .from(claimConversations)
      .innerJoin(claims, eq(claims.id, claimConversations.claimId))
      .where(eq(claimConversations.id, message?.conversationId ?? targetId));
    if (!context || (targetType === 'message' && !message)) notFound();
    const images = message
      ? await tx
          .select({
            id: claimMessageAttachments.id,
            objectKey: claimMessageAttachments.objectKey,
            width: claimMessageAttachments.width,
            height: claimMessageAttachments.height,
          })
          .from(claimMessageAttachments)
          .where(eq(claimMessageAttachments.messageId, message.id))
      : [];
    return {
      ...context,
      userId: message?.senderUserId,
      text: message?.body ?? 'Conversation moderation; no unrelated message history is captured.',
      images,
    };
  }
  const [image] =
    targetType === 'listing_image'
      ? await tx.select().from(listingImages).where(eq(listingImages.id, targetId))
      : [];
  if (targetType === 'listing_image' && !image) notFound();
  const [listing] = await tx
    .select()
    .from(listings)
    .where(eq(listings.id, image?.listingId ?? targetId));
  if (!listing) notFound();
  const images = image
    ? [image]
    : await tx.select().from(listingImages).where(eq(listingImages.listingId, listing.id));
  return {
    listingId: listing.id,
    userId: listing.createdByUserId,
    text: [listing.title, listing.description, listing.location, listing.occurredOn].join('\n'),
    images: images.map(({ id, objectKey, width, height }) => ({ id, objectKey, width, height })),
  };
}

export async function retainEvidence(tx: DatabaseTransaction, payload: EvidencePayload) {
  const createdAt = new Date();
  const [record] = await tx
    .insert(moderationEvidence)
    .values({
      payload,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + EVIDENCE_RETENTION_MS),
    })
    .returning({ id: moderationEvidence.id });
  return record!.id;
}

export async function readEvidence(
  tx: DatabaseTransaction,
  id: string | null,
  storage: ObjectStorage,
) {
  const [record] = id
    ? await tx.select().from(moderationEvidence).where(eq(moderationEvidence.id, id)).for('share')
    : [];
  if (!record)
    throw new ModerationError(
      410,
      'EVIDENCE_UNAVAILABLE',
      'Historical evidence is unavailable for this decision.',
    );
  const ttl = Math.min(300, Math.floor((record.expiresAt.getTime() - Date.now()) / 1000));
  if (record.purgedAt || ttl < 1)
    throw new ModerationError(410, 'EVIDENCE_EXPIRED', 'The evidence retention period has ended.');
  return {
    text: record.payload.text ?? '',
    expiresAt: record.expiresAt.toISOString(),
    images: (record.payload.images ?? []).map(({ objectKey, ...image }) => {
      const remaining = Math.min(300, Math.floor((record.expiresAt.getTime() - Date.now()) / 1000));
      if (remaining < 1)
        throw new ModerationError(
          410,
          'EVIDENCE_EXPIRED',
          'The evidence retention period has ended.',
        );
      const signed = storage.createReadUrl(objectKey, remaining);
      if (new Date(signed.expiresAt) > record.expiresAt)
        throw new Error('Evidence URL exceeds retention');
      return { ...image, ...signed };
    }),
  };
}
