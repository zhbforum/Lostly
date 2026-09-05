import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createRateLimiter } from './rate-limit';
import { createAuthRateLimit } from '@/auth/rate-limit';

test('isolates keys, limits bursts, and permits requests after expiration', () => {
  const consume = createRateLimiter(2, 1000);
  expect(consume('a', 0)).toBeNull();
  expect(consume('a', 1)).toBeNull();
  expect(consume('a', 2)).toBe(1);
  expect(consume('b', 2)).toBeNull();
  expect(consume('a', 1000)).toBeNull();
});

test('bounds memory without evicting active limits', () => {
  const consume = createRateLimiter(1, 1000, 1);
  expect(consume('a', 0)).toBeNull();
  expect(consume('b', 1)).toBe(1);
  expect(consume('a', 2)).toBe(1);
  expect(consume('b', 1000)).toBeNull();
});

test('blocks before invoking expensive auth handlers, including spoofed forwarded IPs', async () => {
  let calls = 0;
  const app = new Elysia().use(createAuthRateLimit()).post('/auth/register', () => {
    calls++;
    return 'ok';
  });
  for (let i = 0; i < 6; i++) {
    const response = await app.handle(
      new Request('http://localhost/auth/register', {
        method: 'POST',
        headers: { 'X-Forwarded-For': '192.0.2.' + i },
      }),
    );
    expect(response.status).toBe(i < 5 ? 200 : 429);
    if (i === 5) expect(response.headers.get('retry-after')).toBeTruthy();
  }
  expect(calls).toBe(5);
});
