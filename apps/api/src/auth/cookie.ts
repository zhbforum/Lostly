import { t, type Cookie } from 'elysia';

import { SESSION_TTL_SECONDS } from '@/auth/session';

export const SESSION_COOKIE_NAME = 'lostly_session';

const SESSION_COOKIE_ATTRIBUTES = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
};

export const sessionCookieSchema = t.Cookie(
  {
    [SESSION_COOKIE_NAME]: t.Optional(t.String()),
  },
  SESSION_COOKIE_ATTRIBUTES,
);

export function setSessionCookie(
  cookie: Cookie<string | undefined>,
  token: string,
  expiresAt: Date,
): void {
  cookie.set({
    ...SESSION_COOKIE_ATTRIBUTES,
    value: token,
    maxAge: SESSION_TTL_SECONDS,
    expires: expiresAt,
  });
}

export function removeSessionCookie(cookie: Cookie<string | undefined>): void {
  cookie.path = '/';
  cookie.remove();
}
