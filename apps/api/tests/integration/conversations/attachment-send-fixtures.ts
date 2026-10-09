import { createApp } from '@/app';
import { MemoryObjectStorage } from '@tests/support/memory-storage';
import { createAttachmentSender } from '@/conversations/send-attachments';
import { createImageProcessingAdmission } from '@/image-upload/processing-admission';
import { createConversationSendRateLimiter } from '@/conversations/rate-limit';
import { conversationFixture } from './fixtures';
import { imageFixture } from '@tests/support/image-fixture';
import { mock } from 'bun:test';

export async function attachmentSendFixture() {
  const fixture = await conversationFixture();
  const storage = new MemoryObjectStorage();
  const processing = createImageProcessingAdmission();
  const quota = mock(createConversationSendRateLimiter(30));
  const send = createAttachmentSender(storage, processing, quota);
  const input = {
    conversationId: fixture.conversation.id,
    userId: fixture.owner.id,
    clientOperationId: crypto.randomUUID(),
    body: '',
    images: [await imageFixture()] as Blob[],
  };
  return { ...fixture, storage, processing, quota, send, input };
}

export function multipartRequest(
  conversationId: string,
  cookie: string,
  images: Blob[],
  body?: string,
  operationId = crypto.randomUUID(),
  signal?: AbortSignal,
) {
  const form = new FormData();
  if (body !== undefined) form.append('body', body);
  for (const image of images) form.append('images', image, 'private-original-name.jpg');
  return new Request(`http://localhost/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: form,
    signal,
    headers: { Cookie: cookie, 'X-CSRF-Protection': '1', 'Idempotency-Key': operationId },
  });
}

export function attachmentHttpApp(storage = new MemoryObjectStorage()) {
  return { api: createApp(storage), storage };
}
