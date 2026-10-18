import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '@/app';
import * as provider from '@/auth/google-provider';
import {
  consumeGoogleState,
  googleReturnTo,
  signInWithGoogle,
  startGoogleAuth,
} from '@/auth/google-service';
import { getSession, login, logout, register } from '@/auth/service';
import { hashSessionToken } from '@/auth/session';
import { db } from '@/db';
import { authIdentities, oauthStates, sessions, users } from '@/db/schema';
import { MemoryObjectStorage } from '@tests/support/memory-storage';

if (!process.env.DATABASE_URL?.endsWith('/lostly_test'))
  throw new Error('Integration tests require the lostly_test database');
const config = {
  clientId: 'test-client',
  clientSecret: 'test-secret',
  redirectUri: 'http://localhost:3000/auth/google/callback',
  webOrigin: 'http://localhost:5173',
};
const identity = {
  subject: 'google-subject',
  email: 'person@example.com',
  displayName: 'Google Person',
};
const password = 'correct horse battery staple';
const saved = {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
};
let api: ReturnType<typeof createApp>;
let exchange: ReturnType<typeof spyOn<typeof provider, 'exchangeGoogleCode'>>;
beforeEach(async () => {
  await db.execute(sql`truncate table users, oauth_states cascade`);
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: config.clientId,
    GOOGLE_CLIENT_SECRET: config.clientSecret,
    GOOGLE_REDIRECT_URI: config.redirectUri,
    WEB_ORIGIN: config.webOrigin,
  });
  api = createApp(new MemoryObjectStorage());
  exchange = spyOn(provider, 'exchangeGoogleCode').mockResolvedValue(identity);
});
afterEach(() => {
  exchange.mockRestore();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
function start(mode: 'login' | 'link' = 'login', cookie = '', returnTo = '/') {
  return api.handle(
    new Request('http://localhost/auth/google/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1', Cookie: cookie },
      body: JSON.stringify({ mode, returnTo }),
    }),
  );
}
async function pending() {
  const response = await start('login', '', '/listings?kind=found#reports');
  expect(response.status).toBe(200);
  const { url } = (await response.json()) as { url: string };
  return {
    state: new URL(url).searchParams.get('state')!,
    cookie: response.headers.get('set-cookie')!.split(';')[0]!,
  };
}
function callback(state: string, cookie: string, extra = 'code=one-time-code') {
  return api.handle(
    new Request(`http://localhost/auth/google/callback?state=${state}&${extra}`, {
      headers: { Cookie: cookie },
    }),
  );
}

test('creates a passwordless account, stores only a token hash, and supports normal sessions', async () => {
  const result = await signInWithGoogle(identity, null);
  expect(await getSession(result.sessionToken)).toMatchObject({ user: result.user });
  const [account] = await db.select().from(users);
  expect(account!.passwordHash).toBeNull();
  expect(await login({ email: identity.email, password })).toMatchObject({ ok: false });
  const [session] = await db.select().from(sessions);
  expect(session!.tokenHash).toBe(hashSessionToken(result.sessionToken));
  expect(session!.tokenHash).not.toBe(result.sessionToken);
});
test('concurrent first sign-ins create one identity and one user', async () => {
  const results = await Promise.all([
    signInWithGoogle(identity, null),
    signInWithGoogle(identity, null),
  ]);
  expect(results[0]!.user.id).toBe(results[1]!.user.id);
  expect(await db.select().from(users)).toHaveLength(1);
  expect(await db.select().from(authIdentities)).toHaveLength(1);
});
test('identifies returning accounts by subject even after Google changes their email', async () => {
  const first = await signInWithGoogle(identity, null);
  const next = await signInWithGoogle({ ...identity, email: 'changed@example.com' }, null);
  expect(next.user.id).toBe(first.user.id);
  expect(next.user.email).toBe(identity.email);
});
test('never auto-links a matching password account and preserves its password and role when explicitly linked', async () => {
  const result = await register({ email: identity.email, password, displayName: 'Local Person' });
  if (!result.ok) throw new Error('Registration failed');
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, result.value.user.id));
  await expect(signInWithGoogle(identity, null)).rejects.toMatchObject({
    reason: 'account_exists',
  });
  expect(await db.select().from(authIdentities)).toHaveLength(0);
  const auth = await getSession(result.value.sessionToken);
  const linked = await signInWithGoogle(identity, auth!.session.id);
  expect(linked.user).toMatchObject({
    id: result.value.user.id,
    displayName: 'Local Person',
    role: 'admin',
  });
  expect((await login({ email: identity.email, password })).ok).toBe(true);
});
test('rejects a different Google email, replaced identity and revoked link session', async () => {
  const account = await signInWithGoogle(identity, null);
  const auth = await getSession(account.sessionToken);
  await expect(
    signInWithGoogle(
      { ...identity, subject: 'different', email: 'other@example.com' },
      auth!.session.id,
    ),
  ).rejects.toMatchObject({ reason: 'account_exists' });
  await expect(
    signInWithGoogle({ ...identity, subject: 'different' }, auth!.session.id),
  ).rejects.toMatchObject({ reason: 'already_linked' });
  await logout(account.sessionToken);
  await expect(signInWithGoogle(identity, auth!.session.id)).rejects.toMatchObject({
    reason: 'session_expired',
  });
});
test('stores browser-bound, expiring state with S256 PKCE and consumes it once atomically', async () => {
  const flow = await startGoogleAuth(config, '//attacker.example', null);
  const url = new URL(flow.url);
  const state = url.searchParams.get('state')!;
  const [record] = await db.select().from(oauthStates);
  expect(record!.stateHash).toBe(hashSessionToken(state));
  expect(record!.browserHash).toBe(hashSessionToken(flow.browser));
  expect(record!.returnTo).toBe('/');
  expect(record!.expiresAt.getTime() - Date.now()).toBeGreaterThan(590_000);
  expect(url.searchParams.get('code_challenge')).toBe(
    createHash('sha256').update(record!.verifier).digest('base64url'),
  );
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  await expect(consumeGoogleState(state, 'another-browser')).rejects.toThrow();
  const results = await Promise.allSettled([
    consumeGoogleState(state, flow.browser),
    consumeGoogleState(state, flow.browser),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
});
test('expired state never reaches the provider', async () => {
  const flow = await pending();
  await db.update(oauthStates).set({ expiresAt: new Date(Date.now() - 1000) });
  const response = await callback(flow.state, flow.cookie);
  expect(response.headers.get('location')).toBe('http://localhost:5173/login?google=failed');
  expect(exchange).not.toHaveBeenCalled();
});
test('start requires CSRF and connecting requires an authenticated session', async () => {
  const noCsrf = await api.handle(
    new Request('http://localhost/auth/google/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'login' }),
    }),
  );
  expect(noCsrf.status).toBe(403);
  expect((await start('link')).status).toBe(401);
  expect(await db.select().from(oauthStates)).toHaveLength(0);
});
test('callback sets the existing strict session cookie and never exposes Google tokens', async () => {
  const flow = await pending();
  expect(flow.cookie).toContain('lostly_google_browser=');
  const response = await callback(flow.state, flow.cookie);
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe(
    'http://localhost:5173/listings?kind=found#reports',
  );
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  const cookies = response.headers.getSetCookie();
  const session = cookies.find((c) => c.startsWith('lostly_session='))!;
  expect(session).toContain('HttpOnly');
  expect(session).toContain('SameSite=Strict');
  expect(cookies.find((c) => c.startsWith('lostly_google_browser='))).toContain('Max-Age=0');
  const me = await api.handle(
    new Request('http://localhost/auth/me', { headers: { Cookie: session.split(';')[0]! } }),
  );
  expect(me.status).toBe(200);
  expect(await me.json()).toMatchObject({ user: { email: identity.email } });
  expect((await callback(flow.state, flow.cookie)).headers.get('location')).toContain(
    'google=failed',
  );
  expect(exchange).toHaveBeenCalledTimes(1);
});
test('callback rejects missing binding and consumes denial without creating users', async () => {
  const flow = await pending();
  expect((await callback(flow.state, '')).headers.get('location')).toContain('google=failed');
  expect(exchange).not.toHaveBeenCalled();
  expect(
    (await callback(flow.state, flow.cookie, 'error=access_denied')).headers.get('location'),
  ).toContain('google=failed');
  expect(await db.select().from(oauthStates)).toHaveLength(0);
  expect(await db.select().from(users)).toHaveLength(0);
});
test('connect works without the strict session cookie on the cross-site callback', async () => {
  const account = await register({ email: identity.email, password, displayName: 'Local Person' });
  if (!account.ok) throw new Error('Registration failed');
  const response = await start('link', `lostly_session=${account.value.sessionToken}`);
  const url = new URL(((await response.json()) as { url: string }).url);
  const result = await callback(
    url.searchParams.get('state')!,
    response.headers.get('set-cookie')!.split(';')[0]!,
  );
  expect(result.headers.get('location')).toBe('http://localhost:5173/?google=linked');
  const status = await api.handle(
    new Request('http://localhost/auth/providers', {
      headers: { Cookie: `lostly_session=${account.value.sessionToken}` },
    }),
  );
  expect(await status.json()).toEqual({ google: { enabled: true, linked: true } });
});
test.each([
  '//evil.example',
  '/%2f%2fevil.example',
  '/\\evil.example',
  '/%0a/evil',
  'https://evil.example',
  '/login',
  '/%6cogin',
])('rejects unsafe return path %s', (path) => {
  expect(googleReturnTo(path, config.webOrigin)).toBe('/');
});
