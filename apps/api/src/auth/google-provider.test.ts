import { afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
  type JWTPayload,
} from 'jose';
import {
  exchangeGoogleCode,
  GoogleAuthError,
  readGoogleConfig,
  verifyGoogleIdToken,
  type GoogleConfig,
} from './google-provider';
import { googleSigningKey } from '@tests/support/google-signing-key';

const config: GoogleConfig = {
  clientId: 'client.apps.googleusercontent.com',
  clientSecret: 'test-secret',
  redirectUri: 'http://localhost:3000/auth/google/callback',
  webOrigin: 'http://localhost:5173',
};
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let keys: ReturnType<typeof createLocalJWKSet>;
let jwks: { keys: JWK[] };
beforeAll(async () => {
  pair = await googleSigningKey;
  jwks = {
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'google-test', alg: 'RS256' }],
  };
  keys = createLocalJWKSet(jwks);
});

async function token(overrides: JWTPayload = {}) {
  return new SignJWT({
    iss: 'https://accounts.google.com',
    aud: config.clientId,
    sub: 'google-subject',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: 'expected-nonce',
    email: 'User@Example.com',
    email_verified: true,
    name: '  Test User  ',
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'google-test' })
    .sign(pair.privateKey);
}

describe('Google authorization code exchange', () => {
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  let fetchMock: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;

  beforeEach(() => {
    fetchMock = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (input: Parameters<typeof fetch>[0]) => {
          if (String(input) === tokenUrl) return Response.json({ id_token: await token() });
          if (String(input) === 'https://www.googleapis.com/oauth2/v3/certs')
            return Response.json(jwks);
          throw new Error('Unexpected OAuth request');
        },
        { preconnect: mock() },
      ),
    );
  });

  afterEach(() => mock.restore());

  const exchange = () =>
    exchangeGoogleCode('one-time-code', 'pkce-verifier', 'expected-nonce', config);

  test('sends the code and PKCE verifier to the token endpoint and verifies the returned signature', async () => {
    const timeout = spyOn(AbortSignal, 'timeout');

    const identity = await exchange();

    expect(identity).toEqual({
      subject: 'google-subject',
      email: 'user@example.com',
      displayName: 'Test User',
    });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe(tokenUrl);
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
    expect(Object.fromEntries(options!.body as URLSearchParams)).toEqual({
      code: 'one-time-code',
      code_verifier: 'pkce-verifier',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    });
    expect(timeout).toHaveBeenCalledWith(10_000);
  });

  test.each([
    {
      label: 'provider rejection',
      response: () => Response.json({ error: 'private provider details' }, { status: 400 }),
    },
    {
      label: 'provider outage',
      response: () => new Response('private provider details', { status: 503 }),
    },
    { label: 'invalid JSON', response: () => new Response('private invalid JSON') },
    { label: 'null response', response: () => Response.json(null) },
    {
      label: 'missing ID token',
      response: () => Response.json({ access_token: 'private-access-token' }),
    },
    { label: 'non-string ID token', response: () => Response.json({ id_token: 42 }) },
    {
      label: 'oversized ID token',
      response: () => Response.json({ id_token: 'x'.repeat(16_385) }),
    },
    {
      label: 'malformed JWT',
      response: () => Response.json({ id_token: 'private-invalid-token' }),
    },
  ])('fails safely without further requests: $label', async ({ response }) => {
    fetchMock.mockResolvedValueOnce(response());

    await expect(exchange()).rejects.toEqual(new GoogleAuthError('failed'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('rejects a valid signature whose nonce does not belong to this authorization attempt', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ id_token: await token({ nonce: 'another-attempt' }) }),
    );

    await expect(exchange()).rejects.toMatchObject({ reason: 'failed' });
  });

  test('network errors do not expose provider details or trigger automatic retries', async () => {
    fetchMock.mockRejectedValueOnce(new Error('private code and client secret'));

    const error = await exchange().catch((error: unknown) => error);

    expect(error).toBeInstanceOf(GoogleAuthError);
    expect(error).toMatchObject({
      reason: 'failed',
      message: 'Google authentication could not be completed',
    });
    expect((error as Error).cause).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('the token request uses its deadline signal and converts cancellation to a safe auth error', async () => {
    const deadline = new AbortController();
    const timeout = spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    fetchMock.mockImplementation(
      Object.assign(
        (_input: Parameters<typeof fetch>[0], options?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), {
              once: true,
            });
          }),
        { preconnect: mock() },
      ),
    );

    const pending = exchange();
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(fetchMock.mock.calls[0]![1]!.signal).toBe(deadline.signal);
    deadline.abort(new DOMException('private request details', 'TimeoutError'));

    await expect(pending).rejects.toEqual(new GoogleAuthError('failed'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
describe('Google ID token verification', () => {
  test('verifies the signature and returns normalized identity', async () => {
    expect(await verifyGoogleIdToken(await token(), config, 'expected-nonce', keys)).toEqual({
      subject: 'google-subject',
      email: 'user@example.com',
      displayName: 'Test User',
    });
  });
  test.each([
    { iss: 'https://attacker.example' },
    { aud: 'other-client' },
    { nonce: 'different' },
    { email_verified: false },
    { email_verified: 'true' },
    { email: 'bad email' },
    { sub: '' },
    { exp: Math.floor(Date.now() / 1000) - 60 },
    { azp: 'other-client' },
    { aud: [config.clientId, 'other-client'] as string[] },
    { iat: Math.floor(Date.now() / 1000) - 700 },
  ])('rejects invalid claims %j', async (claims) => {
    await expect(
      verifyGoogleIdToken(await token(claims), config, 'expected-nonce', keys),
    ).rejects.toThrow();
  });
  test('rejects a token signed with another key', async () => {
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({ nonce: 'expected-nonce' })
      .setProtectedHeader({ alg: 'RS256', kid: 'google-test' })
      .sign(other.privateKey);
    await expect(verifyGoogleIdToken(forged, config, 'expected-nonce', keys)).rejects.toThrow();
  });
});

describe('Google configuration', () => {
  const env = {
    GOOGLE_CLIENT_ID: config.clientId,
    GOOGLE_CLIENT_SECRET: config.clientSecret,
    GOOGLE_REDIRECT_URI: config.redirectUri,
    WEB_ORIGIN: config.webOrigin,
  };
  test('is disabled without credentials and rejects partial settings', () => {
    expect(readGoogleConfig({})).toBeNull();
    expect(() => readGoogleConfig({ GOOGLE_CLIENT_ID: 'client' })).toThrow();
  });
  test('accepts local development and requires production HTTPS', () => {
    expect(readGoogleConfig(env)).toEqual(config);
    expect(() => readGoogleConfig({ ...env, NODE_ENV: 'production' })).toThrow();
    expect(
      readGoogleConfig({
        ...env,
        NODE_ENV: 'production',
        WEB_ORIGIN: 'https://lostly.example',
        GOOGLE_REDIRECT_URI: 'https://lostly.example/api/auth/google/callback',
      }),
    ).not.toBeNull();
  });
  test.each([
    'http://remote.example/auth/google/callback',
    'https://user:pass@api.example/auth/google/callback',
    'https://api.example/auth/google/callback?x=1',
    'https://api.example/wrong',
  ])('rejects unsafe callback %s', (redirectUri) => {
    expect(() => readGoogleConfig({ ...env, GOOGLE_REDIRECT_URI: redirectUri })).toThrow();
  });
});
