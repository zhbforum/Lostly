import { expect, test } from 'bun:test';
import { app } from '@/app';

if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== '/lostly_test')
  throw new Error('Health integration tests require lostly_test');

test('health executes its probe against PostgreSQL and returns the public readiness contract', async () => {
  const response = await app.handle(new Request('http://localhost/health'));

  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ status: 'ok', database: 'connected' });
});
