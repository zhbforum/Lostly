import { claimMessages } from '@/db/conversations';
import { sql } from 'drizzle-orm';

export const messageSelection = {
  id: claimMessages.id,
  conversationId: claimMessages.conversationId,
  sequence: claimMessages.sequence,
  senderUserId: claimMessages.senderUserId,
  isHidden: claimMessages.isHidden,
  body: sql<
    string | null
  >`case when ${claimMessages.isHidden} then null else ${claimMessages.body} end`.as('body'),
  createdAt: claimMessages.createdAt,
};

export type MessageRecord = Pick<typeof claimMessages.$inferSelect, keyof typeof messageSelection>;
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
