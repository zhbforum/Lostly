export const PROFILE_CONSTRAINTS = {
  displayNameMinLength: 2,
  displayNameMaxLength: 80,
  bioMaxLength: 160,
  nameChangeIntervalMs: 7 * 24 * 60 * 60 * 1000,
  usernameMinLength: 3,
  usernameMaxLength: 30,
  usernameChangeIntervalMs: 30 * 24 * 60 * 60 * 1000,
  avatarMaxBytes: 5 * 1024 * 1024,
  avatarDimension: 256,
  avatarMaxFrames: 100,
  avatarMaxPixels: 40_000_000,
} as const;

export interface ProfileAvatar {
  id: string;
  url: string;
  staticUrl: string;
  urlExpiresAt: string;
  animated: boolean;
}

export interface PublicProfile {
  id: string;
  username: string | null;
  displayName: string;
  bio: string;
  createdAt: string;
  avatar: ProfileAvatar | null;
}

export interface UserProfile extends PublicProfile {
  nextDisplayNameChangeAt: string | null;
  nextUsernameChangeAt: string | null;
  version: number;
}

export interface PublicProfileResponse {
  profile: PublicProfile;
}

export interface ProfileResponse {
  profile: UserProfile;
}

export interface UpdateProfileInput {
  displayName: string;
  username?: string;
  bio: string;
  expectedVersion: number;
}

export const USERNAME_PATTERN = '^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$';
const reservedUsernames = new Set([
  'admin',
  'administrator',
  'api',
  'auth',
  'account',
  'accounts',
  'contact',
  'deleted',
  'help',
  'login',
  'logout',
  'lostly',
  'me',
  'moderator',
  'official',
  'privacy',
  'profile',
  'register',
  'root',
  'security',
  'settings',
  'staff',
  'support',
  'system',
  'terms',
  'undefined',
  'null',
  'users',
  'www',
]);

export const normalizeUsername = (value: string) => value.trim().toLowerCase();
export function usernameIssue(value: string): 'invalid' | 'reserved' | null {
  const username = normalizeUsername(value);
  if (!new RegExp(USERNAME_PATTERN).test(username)) return 'invalid';
  return reservedUsernames.has(username) ? 'reserved' : null;
}

export interface UsernameAvailability {
  username: string;
  available: boolean;
  reason: 'invalid' | 'reserved' | 'taken' | null;
}
