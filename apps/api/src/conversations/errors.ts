import type { ConversationFailure } from './selection';

export const CONVERSATION_ERRORS = {
  'conversation-not-found': {
    status: 404,
    code: 'CONVERSATION_NOT_FOUND',
    message: 'Conversation not found',
  },
  'message-not-found': {
    status: 404,
    code: 'MESSAGE_NOT_FOUND',
    message: 'Message not found in this conversation',
  },
  'conversation-read-only': {
    status: 409,
    code: 'CONVERSATION_READ_ONLY',
    message: 'This conversation is read-only',
  },
  'idempotency-conflict': {
    status: 409,
    code: 'IDEMPOTENCY_CONFLICT',
    message: 'This operation key was used for a different message',
  },
  'invalid-message': {
    status: 422,
    code: 'VALIDATION_ERROR',
    message: 'Message must contain 1–2000 valid Unicode code points after normalization',
  },
  'invalid-operation-id': {
    status: 422,
    code: 'VALIDATION_ERROR',
    message: 'Idempotency-Key must be a UUID',
  },
  'rate-limited': {
    status: 429,
    code: 'RATE_LIMITED',
    message: 'Too many new messages. Try again later',
  },
  'invalid-cursor': { status: 400, code: 'INVALID_CURSOR', message: 'Invalid conversation cursor' },
  'invalid-message-query': {
    status: 400,
    code: 'INVALID_MESSAGE_QUERY',
    message: 'Use either before or after, not both',
  },
} as const satisfies Record<
  ConversationFailure | 'invalid-cursor' | 'invalid-message-query',
  {
    status: number;
    code: string;
    message: string;
  }
>;
