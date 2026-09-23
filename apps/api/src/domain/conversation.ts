import type { ClaimStatus } from '@lostly/contracts/claims';
import { CONVERSATION_CONSTRAINTS } from '@lostly/contracts/conversations';

export function canSendConversationMessages(status: ClaimStatus): boolean {
  return status === 'pending' || status === 'approved';
}

export function normalizeMessageBody(input: string): string | null {
  const body = input.replace(/\r\n?/g, '\n').trim();
  const length = Array.from(body).length;
  if (
    !body.isWellFormed() ||
    body.includes('\0') ||
    length < CONVERSATION_CONSTRAINTS.messageMinLength ||
    length > CONVERSATION_CONSTRAINTS.messageMaxLength
  )
    return null;
  return body;
}
