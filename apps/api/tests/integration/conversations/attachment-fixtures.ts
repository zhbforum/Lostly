import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { claimMessages, claimMessageAttachments } from '@/db/conversations';
import { sendClaimMessage } from '@/conversations/send';
import type { conversationFixture } from './fixtures';

export function attachmentValues(messageId: string, position = 0) {
  return {
    messageId,
    position,
    objectKey: `conversations/test/${crypto.randomUUID()}/${position}.webp`,
    sourceHash: 'a'.repeat(64),
    contentType: 'image/webp',
    sizeBytes: 100,
    width: 40,
    height: 60,
  };
}

// Attachment writes are deliberately fixture-only until the reliable send pipeline is implemented.
export async function seedAttachmentMessage(
  fixture: Awaited<ReturnType<typeof conversationFixture>>,
  body: string | null = null,
  positions = [0],
) {
  const result = await sendClaimMessage({
    conversationId: fixture.conversation.id,
    userId: fixture.claimant.id,
    clientOperationId: crypto.randomUUID(),
    body: body ?? 'Fixture image message',
  });
  if (!result.ok) throw new Error(result.reason);
  const message = result.value.message;
  if (body === null)
    await db.update(claimMessages).set({ body: null }).where(eq(claimMessages.id, message.id));
  const attemptId = crypto.randomUUID();
  const attachments = positions.length
    ? await db
        .insert(claimMessageAttachments)
        .values(
          positions.map((position) => ({
            ...attachmentValues(message.id, position),
            objectKey: `conversations/${fixture.conversation.id}/${attemptId}/${position}.webp`,
          })),
        )
        .returning()
    : [];
  return { message: { ...message, body }, attachments };
}
