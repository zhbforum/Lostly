if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== '/lostly_test') {
  throw new Error('Test migrations require an explicit lostly_test database');
}
const subprocess = Bun.spawn(['bun', 'run', 'db:migrate'], {
  stdout: 'inherit',
  stderr: 'inherit',
});
process.exit(await subprocess.exited);
