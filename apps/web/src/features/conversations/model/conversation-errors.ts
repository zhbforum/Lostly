import { ApiError } from '@/shared/api/client';

export function isConversationUnavailable(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 404 && error.code === 'CONVERSATION_NOT_FOUND'
  );
}

export function isReadTargetMissing(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === 'MESSAGE_NOT_FOUND';
}
