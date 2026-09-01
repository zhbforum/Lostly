import { SQL } from 'bun';

import { db } from '@/db';
import { sessions, users } from '@/db/schema';

import { normalizeEmail } from '@/auth/email';
import { hashPassword } from '@/auth/password';
import { generateSessionToken, getSessionExpiresAt, hashSessionToken } from '@/auth/session';
import type { AuthCredentials, RegisterInput, RegisterResult } from '@/auth/types';

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
