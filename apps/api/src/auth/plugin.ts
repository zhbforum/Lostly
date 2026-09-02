import { Elysia } from 'elysia';

import { removeSessionCookie, SESSION_COOKIE_NAME, sessionCookieSchema } from '@/auth/cookie';
import { authErrorSchema } from '@/auth/model';
import { getSession } from '@/auth/service';

const UNAUTHENTICATED_ERROR = {
  error: {
    code: 'UNAUTHENTICATED',
    message: 'Authentication required',
  },
} as const;

export const authenticationPlugin = new Elysia({
  name: 'authentication',
}).macro('authenticated', {
  cookie: sessionCookieSchema,
  response: {
    401: authErrorSchema,
  },
  async resolve({ cookie, status }) {
    const sessionCookie = cookie[SESSION_COOKIE_NAME];
    const token = sessionCookie.value;

    if (!token) {
      return status(401, UNAUTHENTICATED_ERROR);
    }

    const auth = await getSession(token);

    if (!auth) {
      removeSessionCookie(sessionCookie);

      return status(401, UNAUTHENTICATED_ERROR);
    }

    return {
      auth,
    };
  },
});
