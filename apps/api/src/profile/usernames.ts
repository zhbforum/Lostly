import { eq } from 'drizzle-orm';
import {
  normalizeUsername,
  usernameIssue,
  type UsernameAvailability,
} from '@lostly/contracts/profile';
import { db, type DatabaseTransaction } from '@/db';
import { profileUsernames } from '@/db/schema';
import { ProfileError } from './errors';

export async function usernameAvailability(
  userId: string,
  value: string,
): Promise<UsernameAvailability> {
  const username = normalizeUsername(value);
  const issue = usernameIssue(username);
  if (issue) return { username, available: false, reason: issue };
  const [owner] = await db
    .select({ userId: profileUsernames.userId })
    .from(profileUsernames)
    .where(eq(profileUsernames.username, username));
  const available = !owner || owner.userId === userId;
  return { username, available, reason: available ? null : 'taken' };
}

export async function claimUsername(tx: DatabaseTransaction, userId: string, username: string) {
  const issue = usernameIssue(username);
  if (issue)
    throw new ProfileError(issue === 'reserved' ? 'username-reserved' : 'username-invalid');
  const [inserted] = await tx
    .insert(profileUsernames)
    .values({ username, userId })
    .onConflictDoNothing({ target: profileUsernames.username })
    .returning();
  if (inserted) return;
  const [owner] = await tx
    .select({ userId: profileUsernames.userId })
    .from(profileUsernames)
    .where(eq(profileUsernames.username, username));
  if (owner?.userId !== userId) throw new ProfileError('username-taken');
}
