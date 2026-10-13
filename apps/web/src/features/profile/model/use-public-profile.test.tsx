import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PublicProfileResponse } from '@lostly/contracts/profile';
import { ApiError } from '@/shared/api/client';
import { getPublicProfile } from '../api/profile-api';
import { usePublicProfile } from './use-public-profile';

vi.mock('../api/profile-api');
const profile = {
  id: 'alex',
  displayName: 'Alex',
  username: null,
  bio: 'Hello',
  createdAt: '2026-01-01T00:00:00Z',
  avatar: null,
};
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

it('aborts a previous member request and never displays its late response for a different member', async () => {
  let resolve!: (value: PublicProfileResponse) => void;
  vi.mocked(getPublicProfile)
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce({ profile: { ...profile, id: 'sam', displayName: 'Sam' } });
  const { result, rerender } = renderHook(({ id }) => usePublicProfile(id), {
    initialProps: { id: 'alex' },
  });
  rerender({ id: 'sam' });
  await act(async () => {});
  expect(vi.mocked(getPublicProfile).mock.calls[0]![1]?.aborted).toBe(true);
  await act(async () => resolve({ profile }));
  expect(result.current.state).toMatchObject({ status: 'success', profile: { id: 'sam' } });
});

it('renews a public avatar without hiding the profile, retries failures, and clears deleted profiles', async () => {
  vi.useFakeTimers();
  const avatar = {
    id: 'avatar',
    url: 'old',
    staticUrl: 'old-still',
    animated: true,
    urlExpiresAt: new Date(Date.now() + 90_000).toISOString(),
  };
  const fresh = {
    ...avatar,
    url: 'fresh',
    staticUrl: 'fresh-still',
    urlExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
  vi.mocked(getPublicProfile)
    .mockResolvedValueOnce({ profile: { ...profile, avatar } })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ profile: { ...profile, avatar: fresh } })
    .mockRejectedValueOnce(new ApiError(404, 'PROFILE_NOT_FOUND', 'Missing'));
  const { result } = renderHook(() => usePublicProfile('alex'));
  await act(async () => {});
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(result.current.state).toMatchObject({ status: 'success', profile: { avatar } });
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(result.current.state).toMatchObject({ status: 'success', profile: { avatar: fresh } });
  await act(() => vi.advanceTimersByTimeAsync(3_450_000));
  expect(result.current.state).toEqual({ status: 'not-found' });
});

it('distinguishes an unavailable API from a missing profile and allows retry', async () => {
  vi.mocked(getPublicProfile)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ profile });
  const { result } = renderHook(() => usePublicProfile('alex'));
  await act(async () => {});
  expect(result.current.state.status).toBe('error');
  await act(async () => result.current.refresh());
  expect(result.current.state).toMatchObject({ status: 'success', profile });
});
