import { CONVERSATION_IMAGE_CONSTRAINTS } from '@lostly/contracts/conversations';
import { normalizeMessageBody } from '@/domain/conversation';
import { deleteImageObject, logImageCleanup } from '@/image-upload/cleanup';
import { InvalidImageError } from '@/image-upload/errors';
import { prepareImage, readImageSource, type ImageSource } from '@/image-upload/processing';
import type { ImageProcessingAdmission } from '@/image-upload/processing-admission';
import type { ObjectStorage } from '@/storage/object-storage';
import { findAuthorizedMessage, type HydratedMessage } from './attachments';
import { findConversationForMember } from './authorization';
import { conversationSendRateLimit } from './rate-limit';
import { findMessageOperation, sameMessageFingerprint, type MessageOperation } from './replay';
import { commitClaimMessage, MessageCommitUnknownError, type PreparedAttachment } from './send';
import type { ConversationResult } from './selection';
import { ConversationUploadError } from './upload-errors';

async function storeImage(
  storage: ObjectStorage,
  source: ImageSource,
  objectKey: string,
  position: number,
): Promise<PreparedAttachment> {
  const prepared = await prepareImage(source.bytes, {
    maxOutputBytes: CONVERSATION_IMAGE_CONSTRAINTS.maxSizeBytes,
  });
  try {
    await storage.put(objectKey, prepared.data, prepared.contentType);
  } catch (error) {
    logImageCleanup('conversation_attachment_storage_unknown', objectKey);
    throw error;
  }
  return {
    position,
    objectKey,
    sourceHash: source.sourceHash,
    contentType: prepared.contentType,
    sizeBytes: prepared.data.size,
    width: prepared.width,
    height: prepared.height,
  };
}

export function createAttachmentSender(
  storage: ObjectStorage,
  processing: ImageProcessingAdmission,
  consumeQuota = conversationSendRateLimit,
) {
  return async (
    input: MessageOperation & { body: string; images: Blob[] },
  ): Promise<ConversationResult<{ message: HydratedMessage; created: boolean }>> => {
    const access = await findConversationForMember(input.conversationId, input.userId);
    if (!access) return { ok: false, reason: 'conversation-not-found' };
    const normalized = normalizeMessageBody(input.body);
    if (normalized.status === 'invalid') return { ok: false, reason: 'invalid-message' };
    if (!input.images.length || input.images.length > CONVERSATION_IMAGE_CONSTRAINTS.maxCount)
      throw new ConversationUploadError('invalid-multipart');
    const operation = {
      conversationId: access.id,
      userId: input.userId,
      clientOperationId: input.clientOperationId,
    };
    const sources: ImageSource[] = [];
    const uploaded: PreparedAttachment[] = [];
    let sent;
    try {
      for (const file of input.images)
        sources.push(
          await readImageSource(file, { maxBytes: CONVERSATION_IMAGE_CONSTRAINTS.maxSizeBytes }),
        );
      const fingerprint = {
        body: normalized.status === 'text' ? normalized.body : null,
        sourceHashes: sources.map((source) => source.sourceHash),
      };
      const previous = await findMessageOperation(operation);
      if (previous) {
        if (!sameMessageFingerprint(previous, fingerprint))
          return { ok: false, reason: 'idempotency-conflict' };
        sent = { ok: true, value: { message: previous.message, created: false } } as const;
      } else {
        const release = processing.tryAcquire();
        if (!release) throw new ConversationUploadError('busy');
        try {
          const attemptId = crypto.randomUUID();
          while (sources.length) {
            const position = uploaded.length;
            // Each helper invocation retains only its current source and normalized output.
            uploaded.push(
              await storeImage(
                storage,
                sources.shift()!,
                `conversations/${operation.conversationId}/${attemptId}/${position}.webp`,
                position,
              ),
            );
          }
        } finally {
          release();
        }
        sent = await commitClaimMessage(
          { ...operation, ...fingerprint, attachments: uploaded },
          consumeQuota,
        );
      }
    } catch (error) {
      if (error instanceof MessageCommitUnknownError) {
        for (const row of uploaded)
          logImageCleanup('conversation_attachment_commit_unknown', row.objectKey);
      } else {
        for (const row of uploaded) await deleteImageObject(storage, row.objectKey);
      }
      if (error instanceof InvalidImageError) throw new ConversationUploadError('invalid-image');
      throw error;
    } finally {
      sources.length = 0;
    }
    if (!sent.ok || !sent.value.created)
      for (const row of uploaded) await deleteImageObject(storage, row.objectKey);
    if (!sent.ok) return sent;
    // Durability is already settled. Neither visibility nor signer failure can compensate objects.
    const hydrated = await findAuthorizedMessage(
      { ...operation, messageId: sent.value.message.id },
      storage,
    );
    if (!hydrated.ok) return hydrated;
    return { ok: true, value: { message: hydrated.value.message, created: sent.value.created } };
  };
}
