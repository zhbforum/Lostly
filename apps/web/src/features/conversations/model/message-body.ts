import { CONVERSATION_CONSTRAINTS } from './types';

export type MessageBodyNormalization =
  { status: 'text'; body: string } | { status: 'empty' } | { status: 'invalid' };

export interface MessageBodyAnalysis {
  normalization: MessageBodyNormalization;
  // Capped at messageMaxLength + 1; the UI does not need an exact oversized count.
  count: number;
  overLimit: boolean;
}

export function analyzeMessageBody(input: string): MessageBodyAnalysis {
  const body = input.replace(/\r\n?/g, '\n').trim();
  let count = 0;
  let invalid = false;
  for (const character of body) {
    count++;
    const codePoint = character.codePointAt(0)!;
    // for...of combines valid surrogate pairs, leaving only lone surrogates in this range.
    if (codePoint === 0 || (codePoint >= 0xd800 && codePoint <= 0xdfff)) invalid = true;
    if (count > CONVERSATION_CONSTRAINTS.messageMaxLength) {
      return { normalization: { status: 'invalid' }, count, overLimit: true };
    }
  }
  return {
    normalization: invalid
      ? { status: 'invalid' }
      : count > 0
        ? { status: 'text', body }
        : { status: 'empty' },
    count,
    overLimit: false,
  };
}

export function normalizeMessageBody(input: string): MessageBodyNormalization {
  return analyzeMessageBody(input).normalization;
}
