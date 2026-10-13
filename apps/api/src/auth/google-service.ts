import { createHash } from 'node:crypto';
import { SQL } from 'bun';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { authIdentities, oauthStates, sessions, users } from '@/db/schema';
import { generateSessionToken, getSessionExpiresAt, hashSessionToken } from '@/auth/session';
import { GoogleAuthError, type GoogleConfig, type GoogleIdentity } from '@/auth/google-provider';
import type { AuthCredentials } from '@/auth/types';

export const GOOGLE_STATE_TTL_SECONDS = 600;

export function googleReturnTo(value: string = '/', webOrigin: string): string {
  try {
    const path = decodeURIComponent(value.split(/[?#]/)[0]!);
    const url = new URL(value, webOrigin);
    if (
      !value.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('\\') ||
      Array.from(value + path).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      url.origin !== webOrigin ||
      /^\/(login|register)\/?$/.test(decodeURIComponent(url.pathname))
    )
      return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}

export async function startGoogleAuth(
  config: GoogleConfig,
  returnTo: string,
  linkSessionId: string | null,
) {
  const state = generateSessionToken();
  const browser = generateSessionToken();
  const verifier = generateSessionToken();
  const nonce = generateSessionToken();
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
  await db.insert(oauthStates).values({
    stateHash: hashSessionToken(state),
    browserHash: hashSessionToken(browser),
    verifier,
    nonce,
    returnTo: googleReturnTo(returnTo, config.webOrigin),
    linkSessionId,
    expiresAt: new Date(Date.now() + GOOGLE_STATE_TTL_SECONDS * 1000),
  });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return { url: url.href, browser };
}

export async function consumeGoogleState(state: string, browser: string) {
  const [pending] = await db
    .delete(oauthStates)
    .where(
      and(
        eq(oauthStates.stateHash, hashSessionToken(state)),
        eq(oauthStates.browserHash, hashSessionToken(browser)),
        gt(oauthStates.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!pending) throw new GoogleAuthError('failed');
  return pending;
}

export async function signInWithGoogle(
  identity: GoogleIdentity,
  linkSessionId: string | null,
): Promise<AuthCredentials> {
  const sessionToken = generateSessionToken();
  const sessionExpiresAt = getSessionExpiresAt();
  try {
    const user = await db.transaction(async (tx) => {
      // Serialize first sign-in for a subject across API processes.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${'google:' + identity.subject}, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(authIdentities)
        .where(
          and(eq(authIdentities.provider, 'google'), eq(authIdentities.subject, identity.subject)),
        );
      let userId: string;
      if (linkSessionId) {
        const [session] = await tx
          .select()
          .from(sessions)
          .where(and(eq(sessions.id, linkSessionId), gt(sessions.expiresAt, new Date())))
          .for('update');
        if (!session) throw new GoogleAuthError('session_expired');
        userId = session.userId;
        const [owner] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
        if (!owner || owner.email.toLowerCase() !== identity.email)
          throw new GoogleAuthError('account_exists');
        if (existing && existing.userId !== userId) throw new GoogleAuthError('already_linked');
        const [linked] = await tx
          .select()
          .from(authIdentities)
          .where(and(eq(authIdentities.userId, userId), eq(authIdentities.provider, 'google')));
        if (linked && linked.subject !== identity.subject)
          throw new GoogleAuthError('already_linked');
      } else if (existing) {
        userId = existing.userId;
      } else {
        const [account] = await tx
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.email}) = ${identity.email}`);
        if (account) throw new GoogleAuthError('account_exists');
        const [created] = await tx
          .insert(users)
          .values({
            email: identity.email,
            displayName: identity.displayName,
            passwordHash: null,
          })
          .returning({ id: users.id });
        if (!created) throw new Error('Failed to create Google account');
        userId = created.id;
      }
      if (!existing)
        await tx
          .insert(authIdentities)
          .values({ provider: 'google', subject: identity.subject, userId });
      const [account] = await tx
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, userId));
      if (!account) throw new GoogleAuthError('failed');
      await tx
        .insert(sessions)
        .values({ userId, tokenHash: hashSessionToken(sessionToken), expiresAt: sessionExpiresAt });
      return account;
    });
    return { user, sessionToken, sessionExpiresAt };
  } catch (error) {
    const pg =
      error instanceof SQL.PostgresError ? error : error instanceof Error ? error.cause : null;
    if (
      pg instanceof SQL.PostgresError &&
      pg.errno === '23505' &&
      pg.constraint === 'users_email_lower_unique'
    ) {
      throw new GoogleAuthError('account_exists');
    }
    throw error;
  }
}
