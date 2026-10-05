import type { ClaimStatus } from '@lostly/contracts/claims';
import { CONVERSATION_CONSTRAINTS } from '@lostly/contracts/conversations';

export function canSendConversationMessages(status: ClaimStatus): boolean {
  return status === 'pending' || status === 'approved';
}

export type MessageBodyNormalization =
  { status: 'text'; body: string } | { status: 'empty' } | { status: 'invalid' };

export function normalizeMessageBody(input: string): MessageBodyNormalization {
  const body = input.replace(/\r\n?/g, '\n').trim();
  if (!body.isWellFormed() || body.includes('\0')) return { status: 'invalid' };
  let length = 0;
  for (const _ of body) {
    if (++length > CONVERSATION_CONSTRAINTS.messageMaxLength) return { status: 'invalid' };
  }
  return body ? { status: 'text', body } : { status: 'empty' };
}
