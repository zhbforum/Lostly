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
  | 'message-not-found'
  | 'idempotency-conflict'
  | 'invalid-message'
  | 'invalid-operation-id'
  | 'rate-limited';
export type ConversationResult<T, Failure extends ConversationFailure = ConversationFailure> =
  | { ok: true; value: T }
  | { ok: false; reason: Exclude<Failure, 'rate-limited'> }
  | ('rate-limited' extends Failure
      ? { ok: false; reason: 'rate-limited'; retryAfterSeconds: number }
      : never);
