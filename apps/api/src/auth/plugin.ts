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
    403: authErrorSchema,
  },
  async resolve({ cookie, status, request }) {
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

    const path = new URL(request.url).pathname;
    if (auth.user.restriction && path !== '/auth/me' && !/^\/me\/moderation(?:\/|$)/.test(path)) {
      return status(403, {
        error: {
          code: 'ACCOUNT_RESTRICTED',
          message:
            'Your account is restricted. Open moderation notices to view the decision or appeal.',
        },
      });
    }
    return {
      auth,
    };
  },
});
