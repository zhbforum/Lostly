import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getListing } from '@/features/listings/api/listings-api';
import { ApiError } from '@/shared/api/client';
import { photo } from '@/test/fixtures/listing-images';
import { ownerReport, reportId } from '@/test/fixtures/listing-management';
import { deferred } from '@/test/deferred';
import { usePhotoUrls, PHOTO_REFRESH_INTERVAL_MS } from './use-photo-urls';

vi.mock('@/features/listings/api/listings-api');
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const expired = () => ({ ...photo(), urlExpiresAt: new Date(Date.now() - 1000).toISOString() });
const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

it('retries a transient failure after cooldown without a focus-event request storm', async () => {
  const initial = [expired()];
  const fresh = [photo(1)];
  vi.mocked(getListing)
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce({ ...ownerReport(), images: fresh });
  const { result } = renderHook(() => usePhotoUrls(reportId, initial));
  await tick(0);
  for (let i = 0; i < 5; i++) {
    act(() => window.dispatchEvent(new Event('focus')));
    act(() => window.dispatchEvent(new Event('online')));
  }
  await tick(PHOTO_REFRESH_INTERVAL_MS - 1);
  expect(getListing).toHaveBeenCalledTimes(1);
  await tick(1);
  expect(getListing).toHaveBeenCalledTimes(2);
  expect(result.current.images).toEqual(fresh);
});

it('backs off at 30, 60 and at most 120 seconds while retaining recovery', async () => {
  vi.mocked(getListing).mockRejectedValue(new ApiError(503, 'UNAVAILABLE', 'offline'));
  const initial = [expired()];
  renderHook(() => usePhotoUrls(reportId, initial));
  await tick(0);
  expect(getListing).toHaveBeenCalledTimes(1);
  for (const [index, delay] of [30_000, 60_000, 120_000, 120_000].entries()) {
    await tick(delay - 1);
    expect(getListing).toHaveBeenCalledTimes(index + 1);
    await tick(1);
    expect(getListing).toHaveBeenCalledTimes(index + 2);
  }
});

it('skips requests while offline or hidden and resumes on online/visibility events', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const fresh = [photo(1)];
  vi.mocked(getListing)
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce({ ...ownerReport(), images: fresh });
  const initial = [expired()];
  const { result } = renderHook(() => usePhotoUrls(reportId, initial));
  await tick(60_000);
  expect(getListing).not.toHaveBeenCalled();
  online.mockReturnValue(true);
  act(() => window.dispatchEvent(new Event('online')));
  expect(getListing).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await tick(0);
  expect(getListing).toHaveBeenCalledTimes(1);
  online.mockReturnValue(false);
  await tick(60_000);
  expect(getListing).toHaveBeenCalledTimes(1);
  online.mockReturnValue(true);
  act(() => window.dispatchEvent(new Event('online')));
  await tick(0);
  expect(result.current.images).toEqual(fresh);
  expect(getListing).toHaveBeenCalledTimes(2);
});

it('retries failed image-error recovery even before expiry, but never loops on broken bytes', async () => {
  const initial = [photo()];
  const fresh = { ...initial[0], url: 'https://images.example.test/recovered.webp' };
  vi.mocked(getListing)
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce({ ...ownerReport(), images: [fresh] });
  const { result } = renderHook(() => usePhotoUrls(reportId, initial));
  act(() => result.current.onImageError(initial[0]));
  await tick(0);
  await tick(PHOTO_REFRESH_INTERVAL_MS);
  expect(result.current.images).toEqual([fresh]);
  act(() => result.current.onImageError(fresh));
  await tick(120_000);
  expect(getListing).toHaveBeenCalledTimes(2);
});

it('coalesces reconnect, timer, image-error and manual callers into a single request', async () => {
  const pending = deferred<Awaited<ReturnType<typeof getListing>>>();
  vi.mocked(getListing).mockReturnValue(pending.promise);
  const initial = [expired()];
  const { result } = renderHook(() => usePhotoUrls(reportId, initial));
  act(() => window.dispatchEvent(new Event('online')));
  act(() => result.current.onImageError(initial[0]));
  const manual = result.current.refresh();
  await tick(120_000);
  expect(getListing).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve({ ...ownerReport(), images: [photo(1)] });
    await manual;
  });
});

it.each([401, 403, 404])(
  'stops automatic retries after HTTP %s but permits explicit recovery',
  async (status) => {
    vi.mocked(getListing).mockRejectedValueOnce(new ApiError(status, 'UNAVAILABLE', 'unavailable'));
    const initial = [expired()];
    const { result } = renderHook(() => usePhotoUrls(reportId, initial));
    await tick(0);
    await tick(240_000);
    act(() => window.dispatchEvent(new Event('online')));
    expect(getListing).toHaveBeenCalledTimes(1);
    vi.mocked(getListing).mockResolvedValueOnce({ ...ownerReport(), images: [photo(1)] });
    await act(async () => result.current.refresh());
    expect(getListing).toHaveBeenCalledTimes(2);
  },
);

it('does not retry a refresh cancelled by a newer mutation', async () => {
  const pending = deferred<Awaited<ReturnType<typeof getListing>>>();
  vi.mocked(getListing).mockReturnValue(pending.promise);
  const initial = [expired()];
  const { result } = renderHook(() => usePhotoUrls(reportId, initial));
  act(() => result.current.setImages([photo(1)]));
  await act(async () => pending.reject(new DOMException('Aborted', 'AbortError')));
  await tick(240_000);
  expect(getListing).toHaveBeenCalledTimes(1);
});
