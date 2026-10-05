import { asc, inArray } from 'drizzle-orm';
import type { ClaimMessageAttachment } from '@lostly/contracts/conversations';
import type { DatabaseTransaction } from '@/db';
import { claimMessageAttachments } from '@/db/conversations';
import type { ObjectStorage } from '@/storage/object-storage';
import type { MessageRecord } from './selection';

export const CONVERSATION_ATTACHMENT_READ_TTL_SECONDS = 15 * 60;

// The caller must hold the listing FOR SHARE (or stronger) and recheck read authorization in tx.
// Keep that lock through synchronous URL signing so a hide cannot commit before issuance.
// Rejected claims retain read access; sending permission is not required here.
export async function hydrateMessages(
  messages: MessageRecord[],
  storage: ObjectStorage,
  tx: DatabaseTransaction,
) {
  if (!messages.length) return [];
  const rows = await tx
    .select({
      id: claimMessageAttachments.id,
      messageId: claimMessageAttachments.messageId,
      position: claimMessageAttachments.position,
      objectKey: claimMessageAttachments.objectKey,
      width: claimMessageAttachments.width,
      height: claimMessageAttachments.height,
    })
    .from(claimMessageAttachments)
    .where(
      inArray(
        claimMessageAttachments.messageId,
        messages.map((message) => message.id),
      ),
    )
    .orderBy(asc(claimMessageAttachments.messageId), asc(claimMessageAttachments.position));
  const byMessage = new Map<string, ClaimMessageAttachment[]>();
  for (const row of rows) {
    const signed = storage.createReadUrl(row.objectKey, CONVERSATION_ATTACHMENT_READ_TTL_SECONDS);
    const attachments = byMessage.get(row.messageId) ?? [];
    attachments.push({
      id: row.id,
      kind: 'image',
      position: row.position,
      url: signed.url,
      urlExpiresAt: signed.expiresAt,
      width: row.width,
      height: row.height,
    });
    byMessage.set(row.messageId, attachments);
  }
  return messages.map((message) => ({
    id: message.id,
    conversationId: message.conversationId,
    sequence: message.sequence,
    senderUserId: message.senderUserId,
    body: message.body,
    attachments: byMessage.get(message.id) ?? [],
    createdAt: message.createdAt,
  }));
}
