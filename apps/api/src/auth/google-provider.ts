import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { normalizeEmail } from '@/auth/email';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  webOrigin: string;
}

export interface GoogleIdentity {
  subject: string;
  email: string;
  displayName: string;
}

export class GoogleAuthError extends Error {
  constructor(
    public readonly reason: 'failed' | 'account_exists' | 'already_linked' | 'session_expired',
  ) {
    super('Google authentication could not be completed');
  }
}

export function readGoogleConfig(
  env: Record<string, string | undefined> = process.env,
): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId && !clientSecret && !redirectUri) return null;
  if (!clientId || !clientSecret || !redirectUri)
    throw new Error('Google OAuth requires all three GOOGLE_* settings');
  const webOrigin = env.WEB_ORIGIN ?? 'http://localhost:5173';
  for (const value of [redirectUri, webOrigin]) {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(env.NODE_ENV !== 'production' && local && url.protocol === 'http:'))
    ) {
      throw new Error('Google OAuth URLs must use HTTPS (HTTP loopback is allowed in development)');
    }
  }
  if (
    new URL(webOrigin).origin !== webOrigin ||
    !new URL(redirectUri).pathname.endsWith('/auth/google/callback')
  ) {
    throw new Error('Google OAuth requires an exact WEB_ORIGIN and an /auth/google/callback URL');
  }
  return { clientId, clientSecret, redirectUri, webOrigin };
}

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), {
  timeoutDuration: 10_000,
});

export async function verifyGoogleIdToken(
  token: string,
  config: GoogleConfig,
  nonce: string,
  keys: JWTVerifyGetKey = googleKeys,
): Promise<GoogleIdentity> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ['RS256'],
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: config.clientId,
      requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
      maxTokenAge: '10m',
    });
    if (
      payload.nonce !== nonce ||
      (payload.azp !== undefined && payload.azp !== config.clientId) ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== config.clientId) ||
      !payload.sub ||
      payload.sub.length > 255 ||
      payload.email_verified !== true ||
      typeof payload.email !== 'string' ||
      payload.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)
    )
      throw new GoogleAuthError('failed');
    const email = normalizeEmail(payload.email);
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    return {
      subject: payload.sub,
      email,
      displayName: (name || email.split('@')[0]!).slice(0, 80),
    };
  } catch {
    throw new GoogleAuthError('failed');
  }
}

export async function exchangeGoogleCode(
  code: string,
  verifier: string,
  nonce: string,
  config: GoogleConfig,
) {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        code,
        code_verifier: verifier,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!response.ok) throw new GoogleAuthError('failed');
    const tokens = (await response.json()) as { id_token?: unknown };
    if (typeof tokens.id_token !== 'string' || tokens.id_token.length > 16_384)
      throw new GoogleAuthError('failed');
    return await verifyGoogleIdToken(tokens.id_token, config, nonce);
  } catch {
    throw new GoogleAuthError('failed');
  }
}
