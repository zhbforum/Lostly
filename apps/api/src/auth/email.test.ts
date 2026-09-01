import { describe, expect, test } from 'bun:test';

import { normalizeEmail } from '@/auth/email';

describe('normalizeEmail', () => {
  test('trims surrounding whitespace', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
  });

  test('converts email to lowercase', () => {
    expect(normalizeEmail('User@Example.COM')).toBe('user@example.com');
  });

  test('applies trimming and lowercasing together', () => {
    expect(normalizeEmail('  User@Example.COM  ')).toBe('user@example.com');
  });
});
