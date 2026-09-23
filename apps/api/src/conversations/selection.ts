import type { ClaimMessage } from '@lostly/contracts/conversations';
import { claimMessages } from '@/db/conversations';

export const messageSelection = {
  id: claimMessages.id,
  conversationId: claimMessages.conversationId,
  sequence: claimMessages.sequence,
  senderUserId: claimMessages.senderUserId,
  body: claimMessages.body,
  createdAt: claimMessages.createdAt,
};

export type MessageRecord = Omit<ClaimMessage, 'createdAt'> & { createdAt: Date };
export type ConversationFailure =
  | 'conversation-not-found'
  | 'conversation-read-only'
  | 'idempotency-conflict'
  | 'invalid-message'
  | 'invalid-operation-id';
export type ConversationResult<T> =
  { ok: true; value: T } | { ok: false; reason: ConversationFailure };
