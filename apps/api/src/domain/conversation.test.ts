import { describe, expect, test } from 'bun:test';
import { canSendConversationMessages, normalizeMessageBody } from './conversation';

describe('conversation rules', () => {
  test('permits pending and approved claims, but not rejected claims', () => {
    expect(canSendConversationMessages('pending')).toBe(true);
    expect(canSendConversationMessages('approved')).toBe(true);
    expect(canSendConversationMessages('rejected')).toBe(false);
  });

  test('normalizes surrounding whitespace and line endings without interpreting markup', () => {
    expect(normalizeMessageBody('  First line\r\n\r\n  Indented line\rLast line  ')).toBe(
      'First line\n\n  Indented line\nLast line',
    );
    expect(normalizeMessageBody('<script>alert(1)</script> **plain text**')).toBe(
      '<script>alert(1)</script> **plain text**',
    );
  });

  test('bounds normalized Unicode text and rejects empty or invalid database text', () => {
    expect(normalizeMessageBody(' \t\r\n ')).toBeNull();
    expect(normalizeMessageBody('a')).toBe('a');
    expect(normalizeMessageBody('a'.repeat(2000))).toHaveLength(2000);
    expect(normalizeMessageBody('a'.repeat(2001))).toBeNull();
    expect(normalizeMessageBody('😀'.repeat(2000))).toBe('😀'.repeat(2000));
    expect(normalizeMessageBody('😀'.repeat(2001))).toBeNull();
    expect(normalizeMessageBody('hello\0world')).toBeNull();
    expect(normalizeMessageBody('\uD800')).toBeNull();
  });
});
