import { eq, type SQL } from 'drizzle-orm';
import {
  PROFILE_CONSTRAINTS,
  type ProfileAvatar,
  type UserProfile,
  type PublicProfile,
  normalizeUsername,
} from '@lostly/contracts/profile';
import type { AuthUser } from '@lostly/contracts/auth';
import { db, type DatabaseTransaction } from '@/db';
import { users, profileUsernames } from '@/db/schema';
import type { ObjectStorage } from '@/storage/object-storage';
import { ProfileError } from './errors';

export const profileSelection = {
  id: users.id,
  displayName: users.displayName,
  username: users.username,
  usernameChangedAt: users.usernameChangedAt,
  bio: users.bio,
  createdAt: users.createdAt,
  displayNameChangedAt: users.displayNameChangedAt,
  profileVersion: users.profileVersion,
  avatarId: users.avatarId,
  avatarAnimated: users.avatarAnimated,
};
export type ProfileRecord = Pick<typeof users.$inferSelect, keyof typeof profileSelection>;

export async function findProfile(userId: string, tx?: DatabaseTransaction) {
  const query = (tx ?? db).select(profileSelection).from(users).where(eq(users.id, userId));
  const [profile] = tx ? await query.for('update') : await query;
  if (!profile) throw new ProfileError('not-found');
  return profile;
}

export function avatarKeys(userId: string, avatarId: string, animated: boolean) {
  const image = `avatars/${userId}/${avatarId}.webp`;
  return { image, still: animated ? `avatars/${userId}/${avatarId}-still.webp` : image };
}

export function toAvatar(
  profile: Pick<ProfileRecord, 'id' | 'avatarId' | 'avatarAnimated'>,
  storage: ObjectStorage,
): ProfileAvatar | null {
  if (!profile.avatarId) return null;
  const keys = avatarKeys(profile.id, profile.avatarId, profile.avatarAnimated);
  const image = storage.createReadUrl(keys.image, 3600);
  return {
    id: profile.avatarId,
    url: image.url,
    staticUrl: profile.avatarAnimated ? storage.createReadUrl(keys.still, 3600).url : image.url,
    urlExpiresAt: image.expiresAt,
    animated: profile.avatarAnimated,
  };
}

export async function findPublicProfile(
  userId: string,
  storage: ObjectStorage,
): Promise<PublicProfile> {
  return readPublicProfile(eq(users.id, userId), storage);
}

export async function findPublicProfileByUsername(username: string, storage: ObjectStorage) {
  const [owner] = await db
    .select({ userId: profileUsernames.userId })
    .from(profileUsernames)
    .where(eq(profileUsernames.username, normalizeUsername(username)));
  if (!owner?.userId) throw new ProfileError('not-found');
  return findPublicProfile(owner.userId, storage);
}

async function readPublicProfile(condition: SQL, storage: ObjectStorage): Promise<PublicProfile> {
  const [profile] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      username: users.username,
      bio: users.bio,
      createdAt: users.createdAt,
      avatarId: users.avatarId,
      avatarAnimated: users.avatarAnimated,
    })
    .from(users)
    .where(condition)
    .limit(1);
  if (!profile) throw new ProfileError('not-found');
  return {
    id: profile.id,
    displayName: profile.displayName,
    username: profile.username,
    bio: profile.bio,
    createdAt: profile.createdAt.toISOString(),
    avatar: toAvatar(profile, storage),
  };
}

export function nextNameChangeAt(changedAt: Date | null): Date | null {
  return changedAt
    ? new Date(changedAt.getTime() + PROFILE_CONSTRAINTS.nameChangeIntervalMs)
    : null;
}

export function nextUsernameChangeAt(changedAt: Date | null): Date | null {
  return changedAt
    ? new Date(changedAt.getTime() + PROFILE_CONSTRAINTS.usernameChangeIntervalMs)
    : null;
}

export function toProfile(profile: ProfileRecord, storage: ObjectStorage): UserProfile {
  return {
    id: profile.id,
    displayName: profile.displayName,
    username: profile.username,
    bio: profile.bio,
    createdAt: profile.createdAt.toISOString(),
    nextDisplayNameChangeAt: nextNameChangeAt(profile.displayNameChangedAt)?.toISOString() ?? null,
    nextUsernameChangeAt: nextUsernameChangeAt(profile.usernameChangedAt)?.toISOString() ?? null,
    version: profile.profileVersion,
    avatar: toAvatar(profile, storage),
  };
}

export async function withProfileIdentity(
  user: AuthUser,
  storage: ObjectStorage,
): Promise<AuthUser> {
  const profile = await findProfile(user.id);
  return {
    ...user,
    displayName: profile.displayName,
    username: profile.username,
    avatar: toAvatar(profile, storage),
    profileVersion: profile.profileVersion,
  };
}
