import { Elysia, t } from 'elysia';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { authIdentities } from '@/db/schema';
import { SESSION_COOKIE_NAME, setSessionCookie } from '@/auth/cookie';
import { getSession } from '@/auth/service';
import { exchangeGoogleCode, GoogleAuthError, readGoogleConfig } from '@/auth/google-provider';
import {
  consumeGoogleState,
  GOOGLE_STATE_TTL_SECONDS,
  signInWithGoogle,
  startGoogleAuth,
} from '@/auth/google-service';
import { openApiCsrfSecurity } from '@/openapi';

const BROWSER_COOKIE = 'lostly_google_browser';
const cookieAttributes = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

export const createGoogleAuthRoutes = () => {
  const config = readGoogleConfig();
  const webOrigin = config?.webOrigin ?? process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  return new Elysia({ prefix: '/auth', detail: { tags: ['Authentication'] } })
    .get(
      '/providers',
      async ({ cookie }) => {
        const token = cookie[SESSION_COOKIE_NAME]?.value;
        const auth = token ? await getSession(String(token)) : null;
        const [identity] = auth
          ? await db
              .select({ subject: authIdentities.subject })
              .from(authIdentities)
              .where(
                and(eq(authIdentities.userId, auth.user.id), eq(authIdentities.provider, 'google')),
              )
          : [];
        return { google: { enabled: Boolean(config), linked: Boolean(identity) } };
      },
      { detail: { summary: 'Get available sign-in providers' } },
    )
    .post(
      '/google/start',
      async ({ body, cookie, status }) => {
        if (!config)
          return status(503, {
            error: { code: 'GOOGLE_UNAVAILABLE', message: 'Google sign-in is not configured' },
          });
        const token = cookie[SESSION_COOKIE_NAME]?.value;
        const auth = token ? await getSession(String(token)) : null;
        if (body.mode === 'link' && !auth)
          return status(401, {
            error: { code: 'UNAUTHENTICATED', message: 'Sign in before connecting Google' },
          });
        const pending = await startGoogleAuth(
          config,
          body.returnTo ?? '/',
          body.mode === 'link' ? auth!.session.id : null,
        );
        cookie[BROWSER_COOKIE]!.set({
          ...cookieAttributes,
          value: pending.browser,
          maxAge: GOOGLE_STATE_TTL_SECONDS,
        });
        return { url: pending.url };
      },
      {
        body: t.Object({
          mode: t.Union([t.Literal('login'), t.Literal('link')]),
          returnTo: t.Optional(t.String({ maxLength: 2048 })),
        }),
        detail: {
          summary: 'Start Google sign-in or connect Google to the current account',
          security: openApiCsrfSecurity,
        },
      },
    )
    .get(
      '/google/callback',
      async ({ request, cookie, set, redirect }) => {
        set.headers['Referrer-Policy'] = 'no-referrer';
        const query = new URL(request.url).searchParams;
        const state = query.get('state');
        const browser = cookie[BROWSER_COOKIE]?.value;
        cookie[BROWSER_COOKIE]!.set({
          ...cookieAttributes,
          value: '',
          maxAge: 0,
          expires: new Date(0),
        });
        let returnTo = '/login';
        try {
          if (
            !config ||
            !state ||
            state.length > 128 ||
            typeof browser !== 'string' ||
            browser.length > 128
          )
            throw new GoogleAuthError('failed');
          const pending = await consumeGoogleState(state, browser);
          if (pending.linkSessionId) returnTo = pending.returnTo;
          const code = query.get('code');
          if (query.has('error') || !code || code.length > 4096)
            throw new GoogleAuthError('failed');
          const identity = await exchangeGoogleCode(code, pending.verifier, pending.nonce, config);
          const credentials = await signInWithGoogle(identity, pending.linkSessionId);
          setSessionCookie(
            cookie[SESSION_COOKIE_NAME]!,
            credentials.sessionToken,
            credentials.sessionExpiresAt,
          );
          const target = new URL(pending.returnTo, webOrigin);
          if (pending.linkSessionId) target.searchParams.set('google', 'linked');
          return redirect(target.href, 303);
        } catch (error) {
          // Unexpected DB errors reach the private error handler; provider errors never leak tokens.
          if (!(error instanceof GoogleAuthError)) throw error;
          const target = new URL(returnTo, webOrigin);
          target.searchParams.set('google', error.reason);
          return redirect(target.href, 303);
        }
      },
      {
        cookie: t.Cookie({
          lostly_session: t.Optional(t.String()),
          lostly_google_browser: t.Optional(t.String()),
        }),
        detail: { summary: 'Complete Google authorization and start a Lostly session' },
      },
    );
};
