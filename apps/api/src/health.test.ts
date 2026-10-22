import { afterEach, expect, mock, spyOn, test } from 'bun:test';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/lostly_test';
const { app } = await import('@/app');
const { db } = await import('@/db');

afterEach(() => mock.restore());

test('health is public and reports a successful database probe without caching it', async () => {
  const probe = spyOn(db, 'execute').mockResolvedValue([]);

  const response = await app.handle(new Request('http://localhost/health'));

  expect(probe).toHaveBeenCalledTimes(1);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ status: 'ok', database: 'connected' });
});

test('a failed database probe returns a safe 503 and recovery is visible on the next request', async () => {
  const probe = spyOn(db, 'execute')
    .mockResolvedValue([])
    .mockRejectedValueOnce(
      new Error('postgresql://private-user:private-password@database/internal'),
    );

  const failed = await app.handle(new Request('http://localhost/health'));

  expect(failed.status).toBe(503);
  expect(failed.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await failed.json()).toEqual({ status: 'error', database: 'unavailable' });

  const recovered = await app.handle(new Request('http://localhost/health'));

  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toEqual({ status: 'ok', database: 'connected' });
  expect(probe).toHaveBeenCalledTimes(2);
});
