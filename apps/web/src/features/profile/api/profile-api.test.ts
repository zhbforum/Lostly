import { afterEach, expect, it, vi } from 'vitest';
import { userProfile } from '@/test/fixtures/profile';
import {
  checkUsername,
  getProfile,
  getPublicProfile,
  removeAvatar,
  saveProfile,
  uploadAvatar,
} from './profile-api';

afterEach(() => vi.unstubAllGlobals());

it.each(['id', 'username'] as const)(
  'encodes public profile lookup by %s and forwards cancellation',
  async (lookup) => {
    const response = { profile: userProfile() };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    vi.stubGlobal('fetch', fetcher);
    const { signal } = new AbortController();

    await expect(getPublicProfile('member/name', signal, lookup)).resolves.toEqual(response);
    expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe(
      `/${lookup === 'id' ? 'users' : 'u'}/member%2Fname`,
    );
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'GET', signal });
  },
);

it('checks username availability without interpreting the response locally', async () => {
  const response = { username: 'alex/name', available: false, reason: 'invalid' };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
  vi.stubGlobal('fetch', fetcher);
  const { signal } = new AbortController();

  await expect(checkUsername('alex/name', signal)).resolves.toEqual(response);
  expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe(
    '/me/profile/username/alex%2Fname',
  );
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'GET', signal });
});

it('loads the private profile and saves changes with the last observed version', async () => {
  const response = { profile: userProfile() };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(response));
  vi.stubGlobal('fetch', fetcher);
  const { signal } = new AbortController();

  await expect(getProfile(signal)).resolves.toEqual(response);

  const input = {
    displayName: response.profile.displayName,
    bio: 'New bio',
    expectedVersion: response.profile.version,
  };

  await expect(saveProfile(input, signal)).resolves.toEqual(response);
  expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
    '/me/profile',
    '/me/profile',
  ]);
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'GET', signal });
  expect(fetcher.mock.calls[1]![1]).toMatchObject({
    method: 'PATCH',
    signal,
    body: JSON.stringify(input),
  });
});

it('uploads an avatar as multipart with its expected version', async () => {
  const response = { profile: userProfile() };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
  vi.stubGlobal('fetch', fetcher);
  const file = new File(['gif'], 'photo.gif', { type: 'image/gif' });
  const { signal } = new AbortController();

  await expect(uploadAvatar(file, 4, signal)).resolves.toEqual(response);

  const [url, options] = fetcher.mock.calls[0]!;

  expect(new URL(String(url)).pathname).toBe('/me/profile/avatar');
  expect(options).toMatchObject({ method: 'POST', signal, credentials: 'include' });
  expect(Object.fromEntries(options!.body as FormData)).toEqual({ file, expectedVersion: '4' });
  expect(new Headers(options!.headers).has('Content-Type')).toBe(false);
});

it('removes an avatar with version protection and does not retry a conflict', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json(
        { error: { code: 'PROFILE_CHANGED', message: 'Reload your profile' } },
        { status: 409 },
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  const { signal } = new AbortController();

  await expect(removeAvatar(4, signal)).rejects.toMatchObject({
    status: 409,
    code: 'PROFILE_CHANGED',
  });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe('/me/profile/avatar');
  expect(fetcher.mock.calls[0]![1]).toMatchObject({
    method: 'DELETE',
    signal,
    body: JSON.stringify({ expectedVersion: 4 }),
  });
});
