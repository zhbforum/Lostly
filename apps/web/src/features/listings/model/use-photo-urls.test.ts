import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { getListing } from '@/features/listings/api/listings-api';
import { deferred } from '@/test/deferred';
import { photo } from '@/test/fixtures/listing-images';
import { ownerReport, reportId } from '@/test/fixtures/listing-management';
import { usePhotoUrls } from './use-photo-urls';

vi.mock('@/features/listings/api/listings-api');

beforeEach(() => vi.resetAllMocks());

it.each(['success', 'failure'] as const)(
  'shares one pending refresh and its outcome: %s',
  async (outcome) => {
    const pending = deferred<Awaited<ReturnType<typeof getListing>>>();
    vi.mocked(getListing).mockReturnValueOnce(pending.promise);
    const initial = [photo()];
    const { result } = renderHook(() => usePhotoUrls(reportId, initial));
    const first = result.current.refresh();
    const second = result.current.refresh();

    expect(second).toBe(first);

    const settled = vi.fn();
    const results = Promise.allSettled([first, second]).then((values) => {
      settled(values);
      return values;
    });

    await act(async () => {});

    expect(getListing).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();

    const fresh = { ...ownerReport(), images: [photo(1)] };
    const failure = new Error('offline');

    await act(async () => {
      if (outcome === 'success') pending.resolve(fresh);
      else pending.reject(failure);
      await results;
    });

    expect(await results).toEqual(
      outcome === 'success'
        ? [
            { status: 'fulfilled', value: undefined },
            { status: 'fulfilled', value: undefined },
          ]
        : [
            { status: 'rejected', reason: failure },
            { status: 'rejected', reason: failure },
          ],
    );
    expect(result.current.images).toEqual(outcome === 'success' ? fresh.images : initial);

    vi.mocked(getListing).mockResolvedValueOnce(fresh);

    await act(async () => result.current.refresh());

    expect(getListing).toHaveBeenCalledTimes(2);
    expect(result.current.images).toEqual(fresh.images);
  },
);

it.each(['resolve', 'reject'] as const)(
  'keeps mutation data and the newer request when an aborted refresh settles: %s',
  async (outcome) => {
    const older = deferred<Awaited<ReturnType<typeof getListing>>>();
    const newer = deferred<Awaited<ReturnType<typeof getListing>>>();
    vi.mocked(getListing).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const initial = [photo()];
    const { result } = renderHook(() => usePhotoUrls(reportId, initial));
    const oldRefresh = result.current.refresh();
    const oldResults = Promise.allSettled([oldRefresh, result.current.refresh()]);
    const oldSignal = vi.mocked(getListing).mock.calls[0][1];
    const changed = [photo(1)];

    act(() => result.current.setImages(changed));

    expect(oldSignal?.aborted).toBe(true);

    const newRefresh = result.current.refresh();

    await act(async () => {
      if (outcome === 'resolve') older.resolve({ ...ownerReport(), images: initial });
      else older.reject(new DOMException('The request was aborted.', 'AbortError'));
      await oldResults;
    });

    expect(await oldResults).toEqual([
      { status: 'fulfilled', value: undefined },
      { status: 'fulfilled', value: undefined },
    ]);
    expect(result.current.images).toEqual(changed);
    expect(result.current.refresh()).toBe(newRefresh);
    expect(getListing).toHaveBeenCalledTimes(2);

    const fresh = [photo(2)];

    await act(async () => {
      newer.resolve({ ...ownerReport(), images: fresh });
      await newRefresh;
    });

    expect(result.current.images).toEqual(fresh);
  },
);

it('does not suppress an AbortError unless its own controller was aborted', async () => {
  const failure = new DOMException('The request was aborted elsewhere.', 'AbortError');
  vi.mocked(getListing).mockRejectedValueOnce(failure);
  const initial = [photo()];
  const { result } = renderHook(() => usePhotoUrls(reportId, initial));

  await act(async () => {
    await expect(result.current.refresh()).rejects.toBe(failure);
  });

  expect(vi.mocked(getListing).mock.calls[0][1]?.aborted).toBe(false);
  expect(result.current.images).toEqual(initial);
});

it('aborts on a new collection and on unmount without restoring stale images', async () => {
  const older = deferred<Awaited<ReturnType<typeof getListing>>>();
  const newer = deferred<Awaited<ReturnType<typeof getListing>>>();
  vi.mocked(getListing).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  const { result, rerender, unmount } = renderHook(({ id, images }) => usePhotoUrls(id, images), {
    initialProps: { id: reportId, images: [photo()] },
  });
  const oldRefresh = result.current.refresh();
  const oldSignal = vi.mocked(getListing).mock.calls[0][1];
  const images = [photo(1)];

  rerender({ id: 'another-report', images });

  expect(oldSignal?.aborted).toBe(true);

  await act(async () => {
    older.resolve({ ...ownerReport(), images: [photo()] });
    await oldRefresh;
  });

  expect(result.current.images).toEqual(images);

  const newRefresh = result.current.refresh();
  const newSignal = vi.mocked(getListing).mock.calls[1][1];

  unmount();

  expect(newSignal?.aborted).toBe(true);

  newer.resolve({ ...ownerReport(), images: [photo(2)] });
  await newRefresh;
});
