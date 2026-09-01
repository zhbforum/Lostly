import type { userRole } from '@/domain/user';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: userRole;
}

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

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginInput {
  email: string;
  password: string;
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
