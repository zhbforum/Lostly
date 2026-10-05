import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const productionKey = `conversations/${crypto.randomUUID()}/${crypto.randomUUID()}/0.webp`;

test.each([
  {
    args: ['--conversation', productionKey],
    error: 'Conversation smoke does not accept an object key or additional arguments',
  },
  {
    args: ['--conversation', ''],
    error: 'Conversation smoke does not accept an object key or additional arguments',
  },
  {
    args: [productionKey],
    error: 'Only a temporary listing-photo smoke key may be retried',
  },
  {
    args: [`_smoke/listing-photos/${crypto.randomUUID()}.webp`, productionKey],
    error: 'Listing smoke accepts at most one temporary object key',
  },
])('R2 smoke rejects unsafe CLI arguments before configuration: $args', async ({ args, error }) => {
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      'run',
      fileURLToPath(new URL('../../tests/support/r2-smoke.ts', import.meta.url)),
      ...args,
    ],
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    // Fail closed even if argument validation regresses: never use local R2 credentials.
    env: {
      ...process.env,
      R2_ENDPOINT: '',
      R2_BUCKET: '',
      R2_ACCESS_KEY_ID: '',
      R2_SECRET_ACCESS_KEY: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode).not.toBe(0);
  expect(stderr).toContain(error);
  expect(stderr).not.toContain('R2_ENDPOINT, R2_BUCKET');
  expect(stderr).not.toContain('smoke_put_unknown');
  expect(stderr).not.toContain('smoke_cleanup_failed');
  expect(stdout).toBe('');
});
