import { describe, expect, test } from 'bun:test';

import { hashPassword, verifyPassword } from '@/auth/password';

describe('password hashing', () => {
  test('hashes and verifies a password', async () => {
    const password = 'correct horse battery staple';
    const passwordHash = await hashPassword(password);

    expect(passwordHash).not.toBe(password);
    expect(passwordHash).toStartWith('$argon2id$');
    expect(await verifyPassword(password, passwordHash)).toBe(true);
  });

  test('rejects an incorrect password', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');

    expect(await verifyPassword('wrong password', passwordHash)).toBe(false);
  });

  test('preserves password whitespace', async () => {
    const passwordHash = await hashPassword(' password ');

    expect(await verifyPassword(' password ', passwordHash)).toBe(true);
    expect(await verifyPassword('password', passwordHash)).toBe(false);
  });
});
