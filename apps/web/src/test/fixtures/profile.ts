import type { AuthUser } from '@lostly/contracts/auth';
import type { ProfileAvatar, UserProfile } from '@lostly/contracts/profile';

export function profileAvatar(overrides: Partial<ProfileAvatar> = {}): ProfileAvatar {
  return {
    id: 'avatar-1',
    url: 'https://images.example.com/avatar.webp',
    staticUrl: 'https://images.example.com/avatar-static.webp',
    urlExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    animated: true,
    ...overrides,
  };
}

export function userProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'alex',
    username: 'alex_morgan',
    displayName: 'Alex Morgan',
    bio: 'Helping neighbours find their lost things.',
    version: 1,
    createdAt: '2026-01-01T12:00:00Z',
    nextDisplayNameChangeAt: null,
    nextUsernameChangeAt: null,
    avatar: null,
    ...overrides,
  };
}

export function profileUser(overrides: Partial<AuthUser> = {}): AuthUser {
  const profile = userProfile();
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    email: 'alex@example.com',
    role: 'user',
    avatar: profile.avatar,
    profileVersion: profile.version,
    ...overrides,
  };
}
