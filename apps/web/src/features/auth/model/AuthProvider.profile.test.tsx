import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { UserProfile } from '@lostly/contracts/profile';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './auth-context';
import { readDraft, saveDraft } from '@/shared/model/form-drafts';

const user = {
  id: 'user-1',
  email: 'alex@example.com',
  displayName: 'Alex',
  role: 'user',
  profileVersion: 1,
};

function profile(version: number, displayName = 'Alex Rivers'): UserProfile {
  return {
    id: user.id,
    displayName,
    username: 'alex_rivers',
    bio: '',
    createdAt: '2026-01-01T00:00:00Z',
    nextDisplayNameChangeAt: null,
    nextUsernameChangeAt: null,
    avatar: null,
    version,
  };
}

function avatar(expiresIn: number, url = 'https://images.example.com/old.webp') {
  return {
    id: 'avatar-1',
    url,
    staticUrl: url,
    animated: false,
    urlExpiresAt: new Date(Date.now() + expiresIn).toISOString(),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('updates the current profile without clearing drafts and ignores older or unrelated identities', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ user }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await act(async () => {});
  saveDraft('listing', 'keep this draft');
  act(() => result.current.updateProfile(profile(3)));
  expect(result.current.user?.displayName).toBe('Alex Rivers');
  expect(result.current.user?.username).toBe('alex_rivers');
  expect(result.current.user?.email).toBe(user.email);
  expect(result.current.status).toBe('authenticated');
  expect(readDraft('listing')).toBe('keep this draft');
  act(() => {
    result.current.updateProfile(profile(2, 'Stale name'));
    result.current.updateProfile({ ...profile(4), id: 'another-user' });
  });
  expect(result.current.user?.displayName).toBe('Alex Rivers');
  await act(() => result.current.logout());
  act(() => result.current.updateProfile(profile(5)));
  expect(result.current.user).toBeNull();
});

it('renews signed avatar URLs before expiry and retries after a network failure', async () => {
  vi.useFakeTimers();
  const oldAvatar = avatar(90_000);
  const renewedAvatar = avatar(3_600_000, 'https://images.example.com/renewed.webp');
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ user: { ...user, avatar: oldAvatar } }))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(Response.json({ user: { ...user, avatar: renewedAvatar } }));
  vi.stubGlobal('fetch', fetcher);
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await act(async () => {});
  saveDraft('listing', 'keep this draft');
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(result.current.user?.avatar).toEqual(oldAvatar);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(result.current.user?.avatar).toEqual(renewedAvatar);
  expect(readDraft('listing')).toBe('keep this draft');
  expect(result.current.status).toBe('authenticated');
});

it('does not overwrite a newer profile edit with an in-flight renewal and keeps renewing', async () => {
  vi.useFakeTimers();
  const oldAvatar = avatar(90_000);
  const renewedAvatar = avatar(3_600_000, 'https://images.example.com/renewed.webp');
  let resolve!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ user: { ...user, avatar: oldAvatar } }))
    .mockImplementationOnce(() => new Promise<Response>((done) => (resolve = done)))
    .mockResolvedValueOnce(
      Response.json({
        user: { ...user, displayName: 'Alex Rivers', profileVersion: 2, avatar: renewedAvatar },
      }),
    );
  vi.stubGlobal('fetch', fetcher);
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await act(async () => {});
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  act(() => result.current.updateProfile({ ...profile(2), avatar: oldAvatar }));
  await act(async () => resolve(Response.json({ user: { ...user, avatar: renewedAvatar } })));
  expect(result.current.user?.displayName).toBe('Alex Rivers');
  expect(result.current.user?.avatar).toEqual(oldAvatar);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(result.current.user?.avatar).toEqual(renewedAvatar);
  expect(result.current.user?.profileVersion).toBe(2);
});

it('aborts an in-flight renewal on logout and never restores a signed-out user', async () => {
  vi.useFakeTimers();
  let resolve!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ user: { ...user, avatar: avatar(90_000) } }))
    .mockImplementationOnce(() => new Promise<Response>((done) => (resolve = done)))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await act(async () => {});
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  await act(() => result.current.logout());
  expect((fetcher.mock.calls[1]![1].signal as AbortSignal).aborted).toBe(true);
  await act(async () => resolve(Response.json({ user: { ...user, avatar: avatar(3_600_000) } })));
  expect(result.current.user).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(120_000));
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('keeps renewed capabilities when a delayed profile GET has the same version, but accepts replacements and removal', async () => {
  vi.useFakeTimers();
  const oldAvatar = avatar(90_000);
  const freshAvatar = avatar(3_600_000, 'https://images.example.com/fresh.webp');
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ user: { ...user, avatar: oldAvatar } }))
      .mockResolvedValueOnce(Response.json({ user: { ...user, avatar: freshAvatar } })),
  );
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await act(async () => {});
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(result.current.user?.avatar).toEqual(freshAvatar);
  act(() => result.current.updateProfile({ ...profile(1, 'Alex'), avatar: oldAvatar }));
  expect(result.current.user?.avatar).toEqual(freshAvatar);
  act(() => result.current.updateProfile({ ...profile(2), avatar: oldAvatar }));
  expect(result.current.user?.displayName).toBe('Alex Rivers');
  expect(result.current.user?.avatar).toEqual(freshAvatar);
  const replacement = { ...oldAvatar, id: 'different-avatar' };
  act(() => result.current.updateProfile({ ...profile(3), avatar: replacement }));
  expect(result.current.user?.avatar).toEqual(replacement);
  act(() => result.current.updateProfile(profile(4)));
  expect(result.current.user?.avatar).toBeNull();
});
