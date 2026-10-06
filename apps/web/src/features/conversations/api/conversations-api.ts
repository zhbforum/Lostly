import type {
  ClaimMessageResponse,
  ConversationInboxQuery,
  ConversationInboxResponse,
  ConversationMessagesQuery,
  ConversationMessagesResponse,
  ConversationResponse,
  ReadConversationResponse,
  RefreshMessageAttachmentsResponse,
  UnreadConversationsResponse,
} from '../model/types';
import { apiRequest } from '@/shared/api/client';
import type { ConversationMessagePayload } from '../model/send-operations';

const conversationPath = (id: string) => `/conversations/${encodeURIComponent(id)}`;

function queryString(values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query.size ? `?${query}` : '';
}

export function getConversationInbox(query: ConversationInboxQuery = {}, signal?: AbortSignal) {
  return apiRequest<ConversationInboxResponse>(
    `/me/conversations${queryString({ cursor: query.cursor, limit: query.limit })}`,
    { signal },
  );
}

export function getConversation(id: string, signal?: AbortSignal) {
  return apiRequest<ConversationResponse>(conversationPath(id), { signal });
}

export function getConversationMessages(
  id: string,
  query: ConversationMessagesQuery = {},
  signal?: AbortSignal,
) {
  return apiRequest<ConversationMessagesResponse>(
    `${conversationPath(id)}/messages${queryString({
      before: query.before,
      after: query.after,
      limit: query.limit,
    })}`,
    { signal },
  );
}

// Sends belong to the session provider, so route cleanup must not cancel them.
export function sendConversationMessage(
  id: string,
  payload: ConversationMessagePayload,
  operationId: string,
) {
  let body: FormData | { body: string | null };
  if (payload.images.length) {
    body = new FormData();
    if (payload.body !== null) body.append('body', payload.body);
    for (const image of payload.images) body.append('images', image);
  } else {
    body = { body: payload.body };
  }
  return apiRequest<ClaimMessageResponse>(`${conversationPath(id)}/messages`, {
    method: 'POST',
    headers: { 'Idempotency-Key': operationId },
    body,
  });
}

export function readConversation(id: string, messageId: string, signal?: AbortSignal) {
  return apiRequest<ReadConversationResponse>(`${conversationPath(id)}/read`, {
    method: 'POST',
    body: { messageId },
    signal,
  });
}

export function refreshMessageAttachments(conversationId: string, messageId: string) {
  return apiRequest<RefreshMessageAttachmentsResponse>(
    `${conversationPath(conversationId)}/messages/${encodeURIComponent(messageId)}/attachments/refresh`,
    { method: 'POST' },
  );
}

export function getUnreadConversationCount(signal?: AbortSignal) {
  return apiRequest<UnreadConversationsResponse>('/me/conversations/unread-count', { signal });
}
