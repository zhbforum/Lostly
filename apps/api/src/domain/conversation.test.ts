import { describe, expect, test } from 'bun:test';
import { canSendConversationMessages, normalizeMessageBody } from './conversation';

describe('conversation rules', () => {
  test('permits pending and approved claims, but not rejected claims', () => {
    expect(canSendConversationMessages('pending')).toBe(true);
    expect(canSendConversationMessages('approved')).toBe(true);
    expect(canSendConversationMessages('rejected')).toBe(false);
  });

  test('normalizes surrounding whitespace and line endings without interpreting markup', () => {
    expect(normalizeMessageBody('  First line\r\n\r\n  Indented line\rLast line  ')).toEqual({
      status: 'text',
      body: 'First line\n\n  Indented line\nLast line',
    });
    const body = '<script>alert(1)</script> **plain text**';
    expect(normalizeMessageBody(body)).toEqual({ status: 'text', body });
  });

  test('bounds normalized Unicode text and rejects empty or invalid database text', () => {
    expect(normalizeMessageBody(' \t\r\n ')).toEqual({ status: 'empty' });
    for (const body of ['a', 'a'.repeat(2000), '😀'.repeat(2000), '\uFFFD'])
      expect(normalizeMessageBody(body)).toEqual({ status: 'text', body });
    for (const body of [
      'a'.repeat(2001),
      '😀'.repeat(2001),
      'hello\0world',
      '\uD800',
      '\uDC00',
      'x'.repeat(500_000),
    ])
      expect(normalizeMessageBody(body)).toEqual({ status: 'invalid' });
  });
});
