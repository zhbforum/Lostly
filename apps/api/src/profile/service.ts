import { eq } from 'drizzle-orm';
import { normalizeUsername, type UpdateProfileInput } from '@lostly/contracts/profile';
import { db } from '@/db';
import { users } from '@/db/schema';
import type { ObjectStorage } from '@/storage/object-storage';
import { deleteImageObject } from '@/image-upload/cleanup';
import { ProfileError } from './errors';
import {
  avatarKeys,
  findProfile,
  nextNameChangeAt,
  nextUsernameChangeAt,
  profileSelection,
  toProfile,
  type ProfileRecord,
} from './queries';
import { claimUsername } from './usernames';
import { isCaseEvidence } from '@/moderation/evidence-retention';

export function assertProfileVersion(profile: ProfileRecord, expectedVersion: number) {
  if (profile.profileVersion !== expectedVersion) throw new ProfileError('conflict');
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
  storage: ObjectStorage,
) {
  const profile = await db.transaction(async (tx) => {
    const current = await findProfile(userId, tx);
    assertProfileVersion(current, input.expectedVersion);
    const now = new Date();
    const nameChanged = input.displayName !== current.displayName;
    const username =
      input.username === undefined ? current.username : normalizeUsername(input.username);
    const usernameChanged = username !== current.username;
    const availableAt = nextNameChangeAt(current.displayNameChangedAt);
    if (nameChanged && availableAt && availableAt > now) throw new ProfileError('name-locked');
    if (usernameChanged) {
      const usernameAvailableAt = nextUsernameChangeAt(current.usernameChangedAt);
      if (usernameAvailableAt && usernameAvailableAt > now)
        throw new ProfileError('username-locked');
      await claimUsername(tx, userId, username!);
    }
    if (!nameChanged && !usernameChanged && input.bio === current.bio) return current;
    const [updated] = await tx
      .update(users)
      .set({
        displayName: input.displayName,
        username,
        usernameChangedAt: usernameChanged ? now : current.usernameChangedAt,
        bio: input.bio,
        displayNameChangedAt: nameChanged ? now : current.displayNameChangedAt,
        profileVersion: current.profileVersion + 1,
        updatedAt: now,
      })
      .where(eq(users.id, userId))
      .returning(profileSelection);
    return updated!;
  });
  return toProfile(profile, storage);
}

export async function deleteAvatarObjects(profile: ProfileRecord, storage: ObjectStorage) {
  if (!profile.avatarId) return;
  const keys = avatarKeys(profile.id, profile.avatarId, profile.avatarAnimated);
  if (await isCaseEvidence(keys.image)) return;
  await deleteImageObject(storage, keys.image);
  if (keys.still !== keys.image) await deleteImageObject(storage, keys.still);
}

export async function removeAvatar(
  userId: string,
  expectedVersion: number,
  storage: ObjectStorage,
) {
  const result = await db.transaction(async (tx) => {
    const current = await findProfile(userId, tx);
    assertProfileVersion(current, expectedVersion);
    if (!current.avatarId) return { current, updated: current };
    const [updated] = await tx
      .update(users)
      .set({
        avatarId: null,
        avatarAnimated: false,
        profileVersion: current.profileVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning(profileSelection);
    return { current, updated: updated! };
  });
  await deleteAvatarObjects(result.current, storage);
  return toProfile(result.updated, storage);
}
