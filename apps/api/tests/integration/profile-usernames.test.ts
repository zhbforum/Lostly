import { afterAll, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  PROFILE_CONSTRAINTS,
  type ProfileResponse,
  type PublicProfileResponse,
  type UsernameAvailability,
} from '@lostly/contracts/profile';
import { createApp } from '@/app';
import { db } from '@/db';
import { profileUsernames, users } from '@/db/schema';
import { clearDatabase, user } from '@tests/integration/listings/management-fixtures';
import { MemoryObjectStorage } from '@tests/support/memory-storage';

const app = createApp(new MemoryObjectStorage());
beforeEach(clearDatabase);
afterAll(clearDatabase);

function request(path: string, cookie?: string, body?: unknown, csrf = true) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: body === undefined ? 'GET' : 'PATCH',
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { 'X-CSRF-Protection': '1' } : {}),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
async function profile(cookie: string) {
  const response = await request('/me/profile', cookie);
  expect(response.status).toBe(200);
  return ((await response.json()) as ProfileResponse).profile;
}
async function setUsername(cookie: string, username: unknown, expectedVersion = 1, fields = {}) {
  const current = await profile(cookie);
  return request('/me/profile', cookie, {
    displayName: current.displayName,
    bio: current.bio,
    username,
    expectedVersion,
    ...fields,
  });
}
async function availability(cookie: string, username: string) {
  const response = await request(`/me/profile/username/${encodeURIComponent(username)}`, cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as UsernameAvailability;
}
async function unlock(id: string) {
  await db
    .update(users)
    .set({
      usernameChangedAt: new Date(Date.now() - PROFILE_CONSTRAINTS.usernameChangeIntervalMs - 1000),
    })
    .where(eq(users.id, id));
}
async function publicProfile(path: string) {
  const response = await request(path, undefined, undefined, false);
  expect(response.status).toBe(200);
  return ((await response.json()) as PublicProfileResponse).profile;
}

test('username is optional, normalizes case and whitespace, and becomes public without private metadata', async () => {
  const owner = await user('username-owner');
  expect(await profile(owner.cookie)).toMatchObject({ username: null, nextUsernameChangeAt: null });
  expect(await availability(owner.cookie, 'Alex_Morgan')).toEqual({
    username: 'alex_morgan',
    available: true,
    reason: null,
  });
  const response = await setUsername(owner.cookie, '  Alex_Morgan  ');
  expect(response.status).toBe(200);
  const saved = ((await response.json()) as ProfileResponse).profile;
  expect(saved).toMatchObject({
    username: 'alex_morgan',
    displayName: 'username-owner',
    version: 2,
    nextDisplayNameChangeAt: null,
  });
  expect(Date.parse(saved.nextUsernameChangeAt!) - Date.now()).toBeGreaterThan(
    PROFILE_CONSTRAINTS.usernameChangeIntervalMs - 5000,
  );
  for (const path of [`/users/${owner.id}`, '/u/alex_morgan', '/u/ALex_MORGAN']) {
    const result = await publicProfile(path);
    expect(result).toMatchObject({ id: owner.id, username: 'alex_morgan' });
    expect(Object.keys(result).sort()).toEqual([
      'avatar',
      'bio',
      'createdAt',
      'displayName',
      'id',
      'username',
    ]);
  }
  const auth = await request('/auth/me', owner.cookie);
  expect(await auth.json()).toMatchObject({ user: { username: 'alex_morgan', profileVersion: 2 } });
  expect((await request('/u/missing')).status).toBe(404);
  expect((await request('/u/invalid.name')).status).toBe(422);
  expect((await request('/me/profile/username/alex')).status).toBe(401);
  expect(
    (
      await request(
        '/me/profile',
        owner.cookie,
        { displayName: 'username-owner', bio: '', username: 'another_name', expectedVersion: 2 },
        false,
      )
    ).status,
  ).toBe(403);
});

test('reserved and malformed handles never consume a profile version or reserve an address', async () => {
  const owner = await user('username-validation');
  for (const username of [
    'Admin',
    'SUPPORT',
    'settings',
    'lostly',
    '',
    'ab',
    '_alex',
    'alex_',
    'a'.repeat(31),
    'álëx',
    'аlex',
    'a b',
    'alex.name',
    'alex/name',
    'alex\nname',
    null,
    12,
  ]) {
    expect((await setUsername(owner.cookie, username)).status).toBe(422);
  }
  expect(await availability(owner.cookie, 'Admin')).toEqual({
    username: 'admin',
    available: false,
    reason: 'reserved',
  });
  expect(await availability(owner.cookie, 'ab')).toEqual({
    username: 'ab',
    available: false,
    reason: 'invalid',
  });
  expect(await profile(owner.cookie)).toMatchObject({
    username: null,
    version: 1,
    nextUsernameChangeAt: null,
  });
  expect(await db.select().from(profileUsernames)).toHaveLength(0);
});

test('case-insensitive competing claims have one winner and the losing transaction saves nothing', async () => {
  const owners = await Promise.all([user('claim-first'), user('claim-second')]);
  const results = await Promise.all(
    owners.map((owner, index) =>
      setUsername(owner.cookie, index ? 'Shared_Name' : 'shared_name', 1, {
        bio: 'Must be atomic',
      }),
    ),
  );
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  const winnerIndex = results.findIndex((result) => result.status === 200);
  const winner = owners[winnerIndex]!;
  const loser = owners[1 - winnerIndex]!;
  expect(await results[1 - winnerIndex]!.json()).toMatchObject({
    error: { code: 'USERNAME_TAKEN' },
  });
  expect(await profile(loser.cookie)).toMatchObject({ username: null, version: 1, bio: '' });
  expect(await availability(loser.cookie, 'SHARED_NAME')).toMatchObject({
    available: false,
    reason: 'taken',
  });
  expect(await publicProfile('/u/shared_name')).toMatchObject({ id: winner.id });
  expect(await db.select().from(profileUsernames)).toHaveLength(1);
});

test('concurrent same-user updates reserve only the winning username', async () => {
  const owner = await user('username-same-user');
  const results = await Promise.all(
    ['first_handle', 'second_handle'].map((name) => setUsername(owner.cookie, name)),
  );
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  expect(await results.find((result) => result.status === 409)!.json()).toMatchObject({
    error: { code: 'PROFILE_CHANGED' },
  });
  expect(await db.select().from(profileUsernames)).toHaveLength(1);
  expect(await profile(owner.cookie)).toMatchObject({ version: 2 });
});

test('username cooldown is independent, no-op saves do not extend it, and a chosen username cannot be cleared', async () => {
  const owner = await user('independent-locks');
  expect((await setUsername(owner.cookie, 'original_name')).status).toBe(200);
  const original = await profile(owner.cookie);
  const blocked = await setUsername(owner.cookie, 'new_name', 2, { bio: 'Not saved' });
  expect(blocked.status).toBe(409);
  expect(await blocked.json()).toMatchObject({ error: { code: 'USERNAME_LOCKED' } });
  expect((await setUsername(owner.cookie, '', 2)).status).toBe(422);
  expect((await setUsername(owner.cookie, null, 2)).status).toBe(422);
  const same = await setUsername(owner.cookie, 'Original_Name', 2);
  expect(same.status).toBe(200);
  expect(await profile(owner.cookie)).toMatchObject({
    version: 2,
    nextUsernameChangeAt: original.nextUsernameChangeAt,
    bio: '',
  });
  const otherFields = await request('/me/profile', owner.cookie, {
    displayName: 'New display name',
    bio: 'Bio can change',
    expectedVersion: 2,
  });
  expect(otherFields.status).toBe(200);
  expect(await profile(owner.cookie)).toMatchObject({
    username: 'original_name',
    bio: 'Bio can change',
    version: 3,
    nextUsernameChangeAt: original.nextUsernameChangeAt,
  });
  await unlock(owner.id);
  expect((await setUsername(owner.cookie, 'new_name', 3)).status).toBe(200);
  expect(await availability(owner.cookie, 'new_name')).toMatchObject({ available: true });
});

test('all historical usernames and UUID links resolve to the current profile and aliases cannot be stolen', async () => {
  const owner = await user('alias-owner');
  const other = await user('alias-other');
  expect((await setUsername(owner.cookie, 'first_name')).status).toBe(200);
  await unlock(owner.id);
  expect((await setUsername(owner.cookie, 'second_name', 2)).status).toBe(200);
  await unlock(owner.id);
  expect((await setUsername(owner.cookie, 'third_name', 3)).status).toBe(200);
  for (const path of [`/users/${owner.id}`, '/u/first_name', '/u/SECOND_NAME', '/u/third_name'])
    expect(await publicProfile(path)).toMatchObject({ id: owner.id, username: 'third_name' });
  expect((await setUsername(other.cookie, 'first_name')).status).toBe(409);
  expect(await availability(other.cookie, 'second_name')).toMatchObject({
    available: false,
    reason: 'taken',
  });
  await unlock(owner.id);
  expect((await setUsername(owner.cookie, 'first_name', 4)).status).toBe(200);
  expect(await publicProfile('/u/third_name')).toMatchObject({
    id: owner.id,
    username: 'first_name',
  });
  expect(await db.select().from(profileUsernames)).toHaveLength(3);
});

test('deleted accounts leave reserved tombstones rather than transferring old links to somebody else', async () => {
  const owner = await user('deleted-owner');
  expect((await setUsername(owner.cookie, 'never_reassign')).status).toBe(200);
  await db.delete(users).where(eq(users.id, owner.id));
  const other = await user('new-account');
  expect((await request('/u/never_reassign')).status).toBe(404);
  expect(await availability(other.cookie, 'never_reassign')).toMatchObject({ available: false });
  expect((await setUsername(other.cookie, 'never_reassign')).status).toBe(409);
  expect(await db.select().from(profileUsernames)).toMatchObject([
    { username: 'never_reassign', userId: null },
  ]);
});

test('a stale version or a locked display name cannot leave behind a reserved username', async () => {
  const owner = await user('atomic-profile');
  expect(
    (
      await request('/me/profile', owner.cookie, {
        displayName: 'A new display name',
        bio: '',
        expectedVersion: 1,
      })
    ).status,
  ).toBe(200);
  expect((await setUsername(owner.cookie, 'stale_handle', 1)).status).toBe(409);
  expect(
    (await setUsername(owner.cookie, 'locked_handle', 2, { displayName: 'Another name' })).status,
  ).toBe(409);
  expect(await db.select().from(profileUsernames)).toHaveLength(0);
  expect(await profile(owner.cookie)).toMatchObject({ username: null, version: 2 });
});
