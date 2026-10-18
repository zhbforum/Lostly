import { beforeAll, describe, expect, test } from 'bun:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { readGoogleConfig, verifyGoogleIdToken, type GoogleConfig } from './google-provider';

const config: GoogleConfig = {
  clientId: 'client.apps.googleusercontent.com',
  clientSecret: 'test-secret',
  redirectUri: 'http://localhost:3000/auth/google/callback',
  webOrigin: 'http://localhost:5173',
};
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let keys: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  pair = await generateKeyPair('RS256');
  keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'google-test', alg: 'RS256' }],
  });
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
