import { createRateLimiter } from '@/http/rate-limit';

export const CONVERSATION_SEND_RATE_LIMIT = {
  limit: 30,
  windowMs: 60_000,
  maxKeys: 10_000,
} as const;

export function createConversationSendRateLimiter(
  limit: number = CONVERSATION_SEND_RATE_LIMIT.limit,
  windowMs: number = CONVERSATION_SEND_RATE_LIMIT.windowMs,
  maxKeys: number = CONVERSATION_SEND_RATE_LIMIT.maxKeys,
) {
  const consume = createRateLimiter(limit, windowMs, maxKeys);
  return (conversationId: string, userId: string, now = Date.now()) =>
    consume(`${conversationId.toLowerCase()}:${userId.toLowerCase()}`, now);
}

export const conversationSendRateLimit = createConversationSendRateLimiter();
