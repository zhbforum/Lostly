import { Elysia } from 'elysia';
import { createRateLimiter } from '@/http/rate-limit';

export function createAuthRateLimit() {
  const login = createRateLimiter(20, 60_000);
  const register = createRateLimiter(5, 60_000);
  const google = createRateLimiter(10, 60_000);
  const globalBudget = createRateLimiter(200, 60_000, 1);

  return new Elysia({ name: 'auth-rate-limit' }).onRequest(({ request, server, set, status }) => {
    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    const limiter =
      request.method === 'POST'
        ? path === '/auth/login'
          ? login
          : path === '/auth/register'
            ? register
            : path === '/auth/google/start'
              ? google
              : null
        : request.method === 'GET' && path === '/auth/google/callback'
          ? google
          : null;
    if (!limiter) return;
    // Do not trust client-supplied X-Forwarded-For. Behind a proxy this limits the proxy IP too.
    const ip = server?.requestIP(request)?.address ?? 'unknown';
    const retryAfter = limiter(ip) ?? globalBudget('auth');
    if (retryAfter === null) return;
    set.headers['Retry-After'] = String(retryAfter);
    set.headers['Cache-Control'] = 'private, no-store';
    return status(429, {
      error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
    });
  });
}
