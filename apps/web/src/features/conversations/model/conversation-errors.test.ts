import { expect, it } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { isConversationUnavailable, isReadTargetMissing } from './conversation-errors';

it('distinguishes a missing read target from a missing conversation using the error code', () => {
  const missingConversation = new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Unavailable');
  const missingMessage = new ApiError(404, 'MESSAGE_NOT_FOUND', 'Missing target');
  expect(isConversationUnavailable(missingConversation)).toBe(true);
  expect(isReadTargetMissing(missingMessage)).toBe(true);
  expect(isConversationUnavailable(missingMessage)).toBe(false);
  expect(isReadTargetMissing(missingConversation)).toBe(false);
  expect(isConversationUnavailable(new ApiError(404, 'HTTP_ERROR', 'Proxy error'))).toBe(false);
  expect(isConversationUnavailable(new Error('Offline'))).toBe(false);
});
