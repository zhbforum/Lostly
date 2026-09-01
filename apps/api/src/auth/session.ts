import { createHash, randomBytes } from 'node:crypto';

const SESSION_TOKEN_BYTES = 32;

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function getSessionExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
}
