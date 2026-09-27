import { CONVERSATION_CONSTRAINTS } from './types';

export function normalizeMessageBody(input: string): string | null {
  const body = input.replace(/\r\n?/g, '\n').trim();
  const length = Array.from(body).length;
  // In Unicode mode this matches lone surrogates, but never a valid surrogate pair.
  // Equivalent to !isWellFormed(), including browsers without that String method.
  if (
    /[\uD800-\uDFFF]/u.test(body) ||
    body.includes('\0') ||
    length < CONVERSATION_CONSTRAINTS.messageMinLength ||
    length > CONVERSATION_CONSTRAINTS.messageMaxLength
  )
    return null;
  return body;
}
