import { expect } from 'bun:test';
import { createApp } from '@/app';
import { MemoryObjectStorage } from '@tests/support/memory-storage';

export const storage = new MemoryObjectStorage();
export const app = createApp(storage);
export const origin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

export function request(
  path: string,
  cookie?: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  extra: Record<string, string> = {},
) {
  const headers = new Headers({ 'X-CSRF-Protection': '1', Origin: origin, ...extra });
  if (cookie) headers.set('Cookie', cookie);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return app.handle(
    new Request('http://localhost' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export function send(
  id: string,
  cookie: string,
  body = 'Private message',
  key = crypto.randomUUID(),
) {
  return request(`/conversations/${id}/messages`, cookie, { body }, 'POST', {
    'Idempotency-Key': key,
  });
}

export async function jsonOf<T = Record<string, unknown>>(
  response: Promise<Response> | Response,
  status = 200,
): Promise<T> {
  const result = await response;
  expect(result.status).toBe(status);
  expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  return (await result.json()) as T;
}
