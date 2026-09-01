import { describe, expect, test } from 'bun:test';

import {
  generateSessionToken,
  getSessionExpiresAt,
  hashSessionToken,
  SESSION_TTL_SECONDS,
} from '@/auth/session';

describe('generateSessionToken', () => {
  test('generates a base64url token from 32 random bytes', () => {
    const token = generateSessionToken();

    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('hashSessionToken', () => {
  test('hashes a token using SHA-256', () => {
    expect(hashSessionToken('test-token')).toBe(
      '4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e',
    );
  });

  test('returns a 64-character hexadecimal hash', () => {
    expect(hashSessionToken('another-token')).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('getSessionExpiresAt', () => {
  test('adds the configured session lifetime', () => {
    const now = new Date('2026-09-01T10:00:00.000Z');

    expect(getSessionExpiresAt(now)).toEqual(new Date(now.getTime() + SESSION_TTL_SECONDS * 1000));
  });

  test('does not mutate the provided date', () => {
    const now = new Date('2026-09-01T10:00:00.000Z');
    const timestamp = now.getTime();

    getSessionExpiresAt(now);

    expect(now.getTime()).toBe(timestamp);
  });
});
