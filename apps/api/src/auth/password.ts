export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=2,p=1$FF6bevcPhSHGMJ4zQP709OJ7RJdCqnYR+8tHIt6+3k4$6M8gykMxym31QNUjNmC5Uu6rH04MZaSeIfXfQ6MXqvo';

export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, 'argon2id');
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return Bun.password.verify(password, passwordHash);
}
