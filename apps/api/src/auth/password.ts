export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, 'argon2id');
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return Bun.password.verify(password, passwordHash);
}
