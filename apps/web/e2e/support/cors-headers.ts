import type { Request } from '@playwright/test';

export function corsHeaders(request: Request): Record<string, string> {
  // History navigation can change page.url() while an earlier request is still in flight.
  const origin = request.headers()['origin'] ?? 'http://localhost:4175';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Protection, Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'Retry-After',
  };
}
