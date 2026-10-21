import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deferred } from '@/test/deferred';
import { useVisiblePolling } from './use-visible-polling';

let hidden = false;

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('waits for the active request before scheduling the next interval', async () => {
  // GIVEN: the first poll outlives several nominal polling intervals.
  const first = deferred<void>();
  const task = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);

  renderHook(() => useVisiblePolling({ task, intervalMs: 4000 }));
  await act(() => vi.advanceTimersByTimeAsync(20_000));

  expect(task).toHaveBeenCalledOnce();

  // WHEN: it completes, the next interval starts from completion, not from mount.
  await act(async () => first.resolve());
  await act(() => vi.advanceTimersByTimeAsync(3999));

  expect(task).toHaveBeenCalledOnce();

  await act(() => vi.advanceTimersByTimeAsync(1));

  expect(task).toHaveBeenCalledTimes(2);
});

it('coalesces explicit refreshes behind an aborted request even when transport ignores abort', async () => {
  // GIVEN: cancellation does not settle the active transport promise.
  const first = deferred<void>();
  const task = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
  const { result } = renderHook(() => useVisiblePolling({ task, intervalMs: 4000 }));

  // WHEN: several explicit refreshes arrive before the cancelled poll settles.
  act(() => {
    result.current();
    result.current();
    result.current();
  });

  expect(task).toHaveBeenCalledOnce();
  expect(task.mock.calls[0][0].aborted).toBe(true);

  await act(async () => first.resolve());

  // THEN: settling the old poll releases exactly one queued refresh.
  expect(task).toHaveBeenCalledTimes(2);
});

it('pauses while hidden and catches up immediately when visible', async () => {
  hidden = true;

  const task = vi.fn().mockResolvedValue(undefined);

  renderHook(() => useVisiblePolling({ task, intervalMs: 4000 }));
  await act(() => vi.advanceTimersByTimeAsync(30_000));

  expect(task).not.toHaveBeenCalled();

  await act(async () => {
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });

  expect(task).toHaveBeenCalledOnce();

  act(() => {
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await act(() => vi.advanceTimersByTimeAsync(30_000));

  expect(task).toHaveBeenCalledOnce();

  await act(async () => {
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });

  expect(task).toHaveBeenCalledTimes(2);
});

it('cancels on resource change/unmount and does not restart after a late completion', async () => {
  const first = deferred<void>();
  const second = deferred<void>();
  const task = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { rerender, unmount } = renderHook(
    ({ id }) => useVisiblePolling({ task, intervalMs: 4000, resourceKey: id }),
    { initialProps: { id: 'A' } },
  );

  rerender({ id: 'B' });

  expect(task.mock.calls[0][0].aborted).toBe(true);
  expect(task).toHaveBeenCalledTimes(2);

  unmount();

  expect(task.mock.calls[1][0].aborted).toBe(true);

  // WHEN: both cancelled polls settle after unmount, neither can restart polling.
  await act(async () => {
    first.resolve();
    second.resolve();
  });
  await act(() => vi.advanceTimersByTimeAsync(30_000));

  expect(task).toHaveBeenCalledTimes(2);
});

it('recovers after a rejected callback and respects enabled', async () => {
  const task = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(undefined);
  const { rerender } = renderHook(
    ({ enabled }) => useVisiblePolling({ task, intervalMs: 4000, enabled }),
    { initialProps: { enabled: false } },
  );

  expect(task).not.toHaveBeenCalled();

  rerender({ enabled: true });
  await act(() => vi.advanceTimersByTimeAsync(4000));

  expect(task).toHaveBeenCalledTimes(2);

  rerender({ enabled: false });
  await act(() => vi.advanceTimersByTimeAsync(20_000));

  expect(task).toHaveBeenCalledTimes(2);
});
