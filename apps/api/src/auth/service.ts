import { SQL } from 'bun';
import { eq, sql } from 'drizzle-orm';

import { normalizeEmail } from '@/auth/email';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '@/auth/password';
import { generateSessionToken, getSessionExpiresAt, hashSessionToken } from '@/auth/session';
import type {
  AuthContext,
  AuthCredentials,
  LoginInput,
  LoginResult,
  RegisterInput,
  RegisterResult,
} from '@/auth/types';
import { db } from '@/db';
import { sessions, users } from '@/db/schema';

const USERS_EMAIL_LOWER_UNIQUE = 'users_email_lower_unique';

export async function register(input: RegisterInput): Promise<RegisterResult> {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  const sessionToken = generateSessionToken();
  const tokenHash = hashSessionToken(sessionToken);
  const sessionExpiresAt = getSessionExpiresAt();

  try {
    const credentials = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email,
          passwordHash,
          displayName: input.displayName,
        })
        .returning({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          role: users.role,
        });

      if (!user) {
        throw new Error('Failed to create user');
      }

      await tx.insert(sessions).values({
        userId: user.id,
        tokenHash,
        expiresAt: sessionExpiresAt,
      });

      return {
        user,
        sessionToken,
        sessionExpiresAt,
      } satisfies AuthCredentials;
    });

    return {
      ok: true,
      value: credentials,
    };
  } catch (error) {
    if (isEmailTakenError(error)) {
      return {
        ok: false,
        reason: 'email_taken',
      };
    }

    throw error;
  }
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const email = normalizeEmail(input.email);

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const passwordValid = await verifyPassword(input.password, passwordHash);

  if (!user || !passwordValid) {
    return {
      ok: false,
      reason: 'invalid_credentials',
    };
  }

  const sessionToken = generateSessionToken();
  const tokenHash = hashSessionToken(sessionToken);
  const sessionExpiresAt = getSessionExpiresAt();

  await db.insert(sessions).values({
    userId: user.id,
    tokenHash,
    expiresAt: sessionExpiresAt,
  });

  return {
    ok: true,
    value: {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
      sessionToken,
      sessionExpiresAt,
    },
  };
}

export async function getSession(token: string): Promise<AuthContext | null> {
  const tokenHash = hashSessionToken(token);

  const [result] = await db
    .select({
      session: {
        id: sessions.id,
        userId: sessions.userId,
        expiresAt: sessions.expiresAt,
      },
      user: {
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!result) {
    return null;
  }

  if (result.session.expiresAt <= new Date()) {
    await db.delete(sessions).where(eq(sessions.id, result.session.id));

    return null;
  }

  return result;
}

export async function logout(token: string): Promise<void> {
  const tokenHash = hashSessionToken(token);

  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

function isEmailTakenError(error: unknown): boolean {
  const postgresError = getPostgresError(error);

  return postgresError?.errno === '23505' && postgresError.constraint === USERS_EMAIL_LOWER_UNIQUE;
}

function getPostgresError(error: unknown): SQL.PostgresError | null {
  if (error instanceof SQL.PostgresError) {
    return error;
  }

  if (error instanceof Error && error.cause instanceof SQL.PostgresError) {
    return error.cause;
  }

  return null;
}
