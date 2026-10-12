import type { ProfileAvatar } from './profile';

export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  username?: string | null;
  role: UserRole;
  avatar?: ProfileAvatar | null;
  profileVersion?: number;
}

export interface AuthResponse {
  user: AuthUser;
}
export interface LoginInput {
  email: string;
  password: string;
}
export interface RegisterInput extends LoginInput {
  displayName: string;
}
