import { fileURLToPath } from 'node:url';

if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== '/lostly_test') {
  throw new Error('Browser tests require lostly_test');
}
const child = Bun.spawn(['bun', 'run', 'test:e2e'], {
  stdout: 'inherit',
  stderr: 'inherit',
  cwd: fileURLToPath(new URL('../../../web', import.meta.url)),
});
process.exit(await child.exited);
