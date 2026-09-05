import type { AuthUser } from '@lostly/contracts/auth';
export type { AuthUser, LoginInput, RegisterInput } from '@lostly/contracts/auth';

export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: Date;
}

export interface AuthContext {
  user: AuthUser;
  session: AuthSession;
}

export interface AuthCredentials {
  user: AuthUser;
  sessionToken: string;
  sessionExpiresAt: Date;
}

export type RegisterResult =
  | {
      ok: true;
      value: AuthCredentials;
    }
  | {
      ok: false;
      reason: 'email_taken';
    };

export type LoginResult =
  | {
      ok: true;
      value: AuthCredentials;
    }
  | {
      ok: false;
      reason: 'invalid_credentials';
    };
