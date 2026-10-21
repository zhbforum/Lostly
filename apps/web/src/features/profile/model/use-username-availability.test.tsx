import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { UsernameAvailability } from '@lostly/contracts/profile';
import { checkUsername } from '../api/profile-api';
import { useUsernameAvailability } from './use-username-availability';

vi.mock('../api/profile-api');

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

it('debounces checks, aborts superseded requests and ignores a late response for another name', async () => {
  vi.useFakeTimers();
  let resolve!: (value: UsernameAvailability) => void;
  vi.mocked(checkUsername)
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce({ username: 'second_name', available: false, reason: 'taken' });
  const { result, rerender } = renderHook(
    ({ username }) => useUsernameAvailability(username, true),
    { initialProps: { username: 'first_name' } },
  );

  expect(result.current).toBe('checking');

  await act(() => vi.advanceTimersByTimeAsync(349));

  expect(checkUsername).not.toHaveBeenCalled();

  await act(() => vi.advanceTimersByTimeAsync(1));

  const firstSignal = vi.mocked(checkUsername).mock.calls[0]![1]!;

  rerender({ username: 'second_name' });

  expect(firstSignal.aborted).toBe(true);

  await act(() => vi.advanceTimersByTimeAsync(350));

  expect(result.current).toBe('taken');

  await act(async () => resolve({ username: 'first_name', available: true, reason: null }));

  expect(result.current).toBe('taken');
});

it('does not query invalid, reserved, unchanged or locked usernames', async () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ username, enabled }) => useUsernameAvailability(username, enabled),
    { initialProps: { username: 'admin', enabled: true } },
  );

  for (const username of ['admin', 'ab', 'a b', 'valid_but_locked']) {
    rerender({ username, enabled: username !== 'valid_but_locked' });
    await act(() => vi.advanceTimersByTimeAsync(400));

    expect(result.current).toBeNull();
  }

  expect(checkUsername).not.toHaveBeenCalled();
});

it('reports a failed check without preventing an authoritative save and cancels checks on unmount', async () => {
  vi.useFakeTimers();
  vi.mocked(checkUsername).mockRejectedValue(new Error('offline'));
  const { result, unmount } = renderHook(() => useUsernameAvailability('alex_morgan', true));

  await act(() => vi.advanceTimersByTimeAsync(350));

  expect(result.current).toBe('error');

  const signal = vi.mocked(checkUsername).mock.calls[0]![1]!;

  unmount();

  expect(signal.aborted).toBe(true);
});
