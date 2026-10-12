import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import {
  PROFILE_CONSTRAINTS,
  type ProfileResponse,
  type PublicProfileResponse,
} from '@lostly/contracts/profile';
import { createApp } from '@/app';
import { db } from '@/db';
import { users } from '@/db/schema';
import { StorageUnavailableError } from '@/storage/object-storage';
import { createAvatarUploader } from '@/profile/upload';
import { createImageProcessingAdmission } from '@/image-upload/processing-admission';
import { updateProfile } from '@/profile/service';
import { clearDatabase, user } from '@tests/integration/listings/management-fixtures';
import { MemoryObjectStorage } from '@tests/support/memory-storage';
import { imageFixture } from '@tests/support/image-fixture';

let storage: MemoryObjectStorage;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  await clearDatabase();
  storage = new MemoryObjectStorage();
  app = createApp(storage);
});
afterAll(clearDatabase);

function request(path: string, cookie?: string, body?: unknown, method = 'GET', csrf = true) {
  const headers = new Headers();
  if (csrf) headers.set('X-CSRF-Protection', '1');
  if (cookie) headers.set('Cookie', cookie);
  if (body !== undefined && !(body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  return app.handle(
    new Request('http://localhost' + path, {
      method,
      headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    }),
  );
}
async function profileOf(response: Promise<Response> | Response) {
  const result = await response;
  expect(result.status).toBe(200);
  return ((await result.json()) as ProfileResponse).profile;
}
async function upload(cookie: string, expectedVersion: number, file?: File) {
  const form = new FormData();
  form.append('file', file ?? (await imageFixture()));
  form.append('expectedVersion', String(expectedVersion));
  return request('/me/profile/avatar', cookie, form, 'POST');
}

test('profile returns only own editable data and server registration date', async () => {
  const owner = await user('profile-owner');
  const other = await user('profile-other');
  const result = await profileOf(request('/me/profile', owner.cookie));
  expect(result).toMatchObject({
    id: owner.id,
    displayName: 'profile-owner',
    bio: '',
    version: 1,
    avatar: null,
    nextDisplayNameChangeAt: null,
  });
  expect(Object.keys(result).sort()).toEqual([
    'avatar',
    'bio',
    'createdAt',
    'displayName',
    'id',
    'nextDisplayNameChangeAt',
    'nextUsernameChangeAt',
    'username',
    'version',
  ]);
  const [record] = await db.select().from(users).where(eq(users.id, owner.id));
  expect(result.createdAt).toBe(record!.createdAt.toISOString());
  expect((await profileOf(request('/me/profile', other.cookie))).id).toBe(other.id);
  expect((await request('/me/profile')).status).toBe(401);
  expect(
    (
      await request(
        '/me/profile',
        owner.cookie,
        { displayName: 'Name', bio: '', expectedVersion: 1 },
        'PATCH',
        false,
      )
    ).status,
  ).toBe(403);
  const anonymous = new FormData();
  anonymous.append('file', await imageFixture());
  anonymous.append('expectedVersion', '1');
  expect((await request('/me/profile/avatar', undefined, anonymous, 'POST')).status).toBe(401);
  expect(storage.objects.size).toBe(0);
});

test('public profiles work without a session and expose only the explicit public allowlist', async () => {
  const owner = await user('public-member');
  const other = await user('public-viewer');
  const saved = await updateProfile(
    owner.id,
    { displayName: 'Public member', bio: 'A public introduction.', expectedVersion: 1 },
    storage,
  );
  const original = await imageFixture();
  const withAvatar = await profileOf(
    upload(owner.cookie, saved.version, new File([await original.arrayBuffer()], 'photo.png')),
  );
  for (const cookie of [undefined, other.cookie, owner.cookie]) {
    const response = await request(`/users/${owner.id}`, cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const { profile } = (await response.json()) as PublicProfileResponse;
    expect(Object.keys(profile).sort()).toEqual([
      'avatar',
      'bio',
      'createdAt',
      'displayName',
      'id',
      'username',
    ]);
    expect(profile).toMatchObject({
      id: owner.id,
      displayName: 'Public member',
      bio: 'A public introduction.',
      createdAt: saved.createdAt,
    });
    expect(profile.avatar?.id).toBe(withAvatar.avatar!.id);
    expect(Object.keys(profile.avatar!).sort()).toEqual([
      'animated',
      'id',
      'staticUrl',
      'url',
      'urlExpiresAt',
    ]);
  }
  expect((await request(`/users/${Bun.randomUUIDv7()}`)).status).toBe(404);
  expect((await request('/users/not-a-uuid')).status).toBe(422);
  expect((await request('/users')).status).toBe(404);
  expect(
    (await request(`/users/${owner.id}`, other.cookie, { bio: 'Cannot write' }, 'PATCH')).status,
  ).toBe(404);
  expect(
    (
      await request(
        '/me/profile',
        undefined,
        { displayName: 'Changed', bio: '', expectedVersion: withAvatar.version },
        'PATCH',
      )
    ).status,
  ).toBe(401);
  expect((await profileOf(request('/me/profile', owner.cookie))).bio).toBe(
    'A public introduction.',
  );
});

test('name changes are locked for seven days while bio edits and no-op saves do not consume the allowance', async () => {
  const owner = await user('name-owner');
  const path = '/me/profile';
  const first = await profileOf(
    request(
      path,
      owner.cookie,
      { displayName: '  Alex Morgan  ', bio: '  Hello  ', expectedVersion: 1 },
      'PATCH',
    ),
  );
  expect(first.displayName).toBe('Alex Morgan');
  expect(first.bio).toBe('Hello');
  expect(Date.parse(first.nextDisplayNameChangeAt!) - Date.now()).toBeGreaterThan(
    PROFILE_CONSTRAINTS.nameChangeIntervalMs - 5000,
  );
  const blocked = await request(
    path,
    owner.cookie,
    { displayName: 'Another Name', bio: 'Not saved', expectedVersion: 2 },
    'PATCH',
  );
  expect(blocked.status).toBe(409);
  expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe(
    'DISPLAY_NAME_LOCKED',
  );
  const bio = await profileOf(
    request(
      path,
      owner.cookie,
      { displayName: 'Alex Morgan', bio: 'New bio', expectedVersion: 2 },
      'PATCH',
    ),
  );
  expect(bio.nextDisplayNameChangeAt).toBe(first.nextDisplayNameChangeAt);
  expect(bio.version).toBe(3);
  const unchanged = await profileOf(
    request(
      path,
      owner.cookie,
      { displayName: 'Alex Morgan', bio: 'New bio', expectedVersion: 3 },
      'PATCH',
    ),
  );
  expect(unchanged.version).toBe(3);
  await db
    .update(users)
    .set({ displayNameChangedAt: new Date(Date.now() - PROFILE_CONSTRAINTS.nameChangeIntervalMs) })
    .where(eq(users.id, owner.id));
  const allowed = await profileOf(
    request(
      path,
      owner.cookie,
      { displayName: 'Alex New', bio: 'New bio', expectedVersion: 3 },
      'PATCH',
    ),
  );
  expect(allowed.displayName).toBe('Alex New');
  const session = await request('/auth/me', owner.cookie);
  expect(((await session.json()) as { user: { displayName: string } }).user.displayName).toBe(
    'Alex New',
  );
});

test('concurrent writes cannot bypass the weekly name limit or overwrite a newer profile', async () => {
  const owner = await user('race-owner');
  const requests = ['First name', 'Second name'].map((displayName) =>
    request('/me/profile', owner.cookie, { displayName, bio: '', expectedVersion: 1 }, 'PATCH'),
  );
  const results = await Promise.all(requests);
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  const current = await profileOf(request('/me/profile', owner.cookie));
  const locked = await request(
    '/me/profile',
    owner.cookie,
    { displayName: 'Third name', bio: '', expectedVersion: current.version },
    'PATCH',
  );
  expect(locked.status).toBe(409);
});

test('validates blank names, bio limits and immutable profile fields', async () => {
  const owner = await user('validation-owner');
  for (const body of [
    { displayName: ' ', bio: '', expectedVersion: 1 },
    { displayName: 'Valid name', bio: 'x'.repeat(161), expectedVersion: 1 },
    { displayName: 'Valid name', bio: '', expectedVersion: 0 },
  ])
    expect((await request('/me/profile', owner.cookie, body, 'PATCH')).status).toBe(422);
  const before = await profileOf(request('/me/profile', owner.cookie));
  await request(
    '/me/profile',
    owner.cookie,
    {
      displayName: before.displayName,
      bio: '',
      expectedVersion: 1,
      createdAt: '2000-01-01',
      role: 'admin',
      displayNameChangedAt: null,
    },
    'PATCH',
  );
  const [record] = await db.select().from(users).where(eq(users.id, owner.id));
  expect(record!.role).toBe('user');
  expect(record!.createdAt.toISOString()).toBe(before.createdAt);
});

test('avatar lifecycle updates auth, preserves GIF animation and cleans replaced R2 objects', async () => {
  const owner = await user('avatar-owner');
  const first = await profileOf(upload(owner.cookie, 1));
  expect(first.avatar?.animated).toBe(false);
  expect(storage.objects.size).toBe(1);
  expect([...storage.objects.keys()][0]).toBe(`avatars/${owner.id}/${first.avatar!.id}.webp`);
  const frames = await Promise.all(
    ['#ff0000', '#00ff00'].map(async (color) =>
      Buffer.from(await (await imageFixture('png', color)).arrayBuffer()),
    ),
  );
  const gif = await sharp(frames, { join: { animated: true } })
    .gif({ delay: [100, 200] })
    .toBuffer();
  const second = await profileOf(
    upload(
      owner.cookie,
      first.version,
      new File([new Uint8Array(gif)], 'avatar.gif', { type: 'image/gif' }),
    ),
  );
  expect(second.avatar?.animated).toBe(true);
  expect(storage.objects.size).toBe(2);
  expect([...storage.objects.keys()].every((key) => key.includes(second.avatar!.id))).toBe(true);
  const current = await request('/auth/me', owner.cookie);
  expect(((await current.json()) as { user: { avatar: { id: string } } }).user.avatar.id).toBe(
    second.avatar!.id,
  );
  const removed = await profileOf(
    request('/me/profile/avatar', owner.cookie, { expectedVersion: second.version }, 'DELETE'),
  );
  expect(removed.avatar).toBeNull();
  expect(storage.objects.size).toBe(0);
  expect(removed.nextDisplayNameChangeAt).toBeNull();
});

test('invalid and stale avatar writes leave the current photo untouched', async () => {
  const owner = await user('avatar-invalid');
  const first = await profileOf(upload(owner.cookie, 1));
  expect(
    (
      await upload(
        owner.cookie,
        first.version,
        new File(['<svg/>'], 'fake.png', { type: 'image/png' }),
      )
    ).status,
  ).toBe(422);
  expect((await upload(owner.cookie, 1)).status).toBe(409);
  expect(
    (await request('/me/profile/avatar', owner.cookie, { expectedVersion: 1 }, 'DELETE')).status,
  ).toBe(409);
  expect(storage.objects.size).toBe(1);
  expect((await profileOf(request('/me/profile', owner.cookie))).avatar!.id).toBe(first.avatar!.id);
});

test('storage failure keeps the prior avatar and does not consume the profile version', async () => {
  const owner = await user('avatar-storage-failure');
  const first = await profileOf(upload(owner.cookie, 1));
  const write = spyOn(storage, 'put').mockRejectedValue(new StorageUnavailableError());
  const log = spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect((await upload(owner.cookie, first.version)).status).toBe(503);
    const current = await profileOf(request('/me/profile', owner.cookie));
    expect(current.version).toBe(first.version);
    expect(current.avatar!.id).toBe(first.avatar!.id);
  } finally {
    write.mockRestore();
    log.mockRestore();
  }
});

test('a profile change during avatar processing discards only the uncommitted new objects', async () => {
  const owner = await user('avatar-race');
  const first = await profileOf(upload(owner.cookie, 1));
  const put = storage.put.bind(storage);
  let stored!: () => void;
  const arrived = new Promise<void>((resolve) => {
    stored = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = spyOn(storage, 'put').mockImplementation(async (...args) => {
    await put(...args);
    stored();
    await gate;
  });
  try {
    const uploader = createAvatarUploader(storage, createImageProcessingAdmission());
    const pending = uploader(owner.id, await imageFixture('png', '#ff0000'), first.version);
    const outcome = pending.then(
      () => null,
      (error: unknown) => error,
    );
    await arrived;
    await updateProfile(
      owner.id,
      { displayName: 'avatar-race', bio: 'A new bio', expectedVersion: first.version },
      storage,
    );
    release();
    expect(await outcome).toMatchObject({ reason: 'conflict' });
    expect(storage.objects.size).toBe(1);
    expect([...storage.objects.keys()][0]).toContain(first.avatar!.id);
  } finally {
    release();
    write.mockRestore();
  }
});
