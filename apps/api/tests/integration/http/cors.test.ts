import { describe, expect, test } from 'bun:test';

import { app } from '@/app';

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
const ADMIN_ORIGIN = process.env.ADMIN_ORIGIN ?? 'http://localhost:4200';

describe('CORS', () => {
  test('allows the web application origin', async () => {
    const response = await app.handle(
      new Request('http://localhost/', {
        headers: {
          origin: WEB_ORIGIN,
        },
      }),
    );

    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });

  test('allows the admin application origin', async () => {
    const response = await app.handle(
      new Request('http://localhost/', {
        headers: {
          origin: ADMIN_ORIGIN,
        },
      }),
    );

    expect(response.headers.get('access-control-allow-origin')).toBe(ADMIN_ORIGIN);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });

  test('does not allow an unknown origin', async () => {
    const response = await app.handle(
      new Request('http://localhost/', {
        headers: {
          origin: 'https://example.com',
        },
      }),
    );

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('handles credentialed preflight requests', async () => {
    const response = await app.handle(
      new Request('http://localhost/auth/login', {
        method: 'OPTIONS',
        headers: {
          origin: WEB_ORIGIN,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,x-csrf-protection',
        },
      }),
    );

    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');

    const methods = response.headers.get('access-control-allow-methods');
    const headers = response.headers.get('access-control-allow-headers');

    expect(methods).toContain('POST');
    expect(headers?.toLowerCase()).toContain('content-type');
    expect(headers?.toLowerCase()).toContain('x-csrf-protection');
  });
});
