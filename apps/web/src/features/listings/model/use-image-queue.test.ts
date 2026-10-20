import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { uploadListingImage } from '@/features/listings/api/listing-images-api';
import { deferred } from '@/test/deferred';
import { photo } from '@/test/fixtures/listing-images';
import { reportId } from '@/test/fixtures/listing-management';

import { useImageQueue } from './use-image-queue';

vi.mock('@/features/listings/api/listing-images-api');

beforeEach(() => {
  vi.resetAllMocks();
});

function imageFile(name: string) {
  return new File([name], `${name}.png`, {
    type: 'image/png',
  });
}

it('retains create progress by default and explicitly discards only completed files', async () => {
  vi.mocked(uploadListingImage)
    .mockResolvedValueOnce({ image: photo() })
    .mockRejectedValueOnce(new Error('offline'));

  const { result } = renderHook(() => useImageQueue());
  const files = ['a', 'b'].map(imageFile);

  act(() => {
    result.current.add(files);
  });

  await act(async () => {
    await result.current.upload(reportId);
  });

  expect(result.current.items.map((item) => item.status)).toEqual(['uploaded', 'failed']);

  const failed = result.current.items[1];

  let discardedCount!: number;

  act(() => {
    discardedCount = result.current.discardUploaded();
  });

  expect(discardedCount).toBe(1);
  expect(result.current.items).toEqual([failed]);
  expect(result.current.items[0]).toBe(failed);
  expect(result.current.items.some((item) => item.file === files[0])).toBe(false);

  act(() => {
    discardedCount = result.current.discardUploaded();
  });

  expect(discardedCount).toBe(0);
  expect(result.current.items[0]).toBe(failed);
});

it('locks queue edits and duplicate uploads until the active upload settles', async () => {
  const pending = deferred<Awaited<ReturnType<typeof uploadListingImage>>>();

  vi.mocked(uploadListingImage).mockReturnValueOnce(pending.promise);

  const { result } = renderHook(() => useImageQueue());

  act(() => {
    result.current.add([imageFile('original')]);
  });

  const id = result.current.items[0].id;

  let upload!: Promise<void>;

  act(() => {
    upload = result.current.upload(reportId);
  });

  expect(result.current.busy).toBe(true);

  let discardedCount!: number;

  await act(async () => {
    result.current.add([imageFile('extra')]);
    result.current.remove(id);

    discardedCount = result.current.discardUploaded();

    await result.current.upload(reportId);
  });

  expect(discardedCount).toBe(0);
  expect(uploadListingImage).toHaveBeenCalledOnce();
  expect(result.current.items).toEqual([
    expect.objectContaining({
      id,
      status: 'uploading',
    }),
  ]);

  await act(async () => {
    pending.resolve({ image: photo() });
    await upload;
  });

  expect(result.current.busy).toBe(false);

  act(() => {
    discardedCount = result.current.discardUploaded();
  });

  expect(discardedCount).toBe(1);

  act(() => {
    result.current.add([imageFile('replacement')]);
  });

  expect(result.current.items).toEqual([
    expect.objectContaining({
      file: expect.objectContaining({
        name: 'replacement.png',
      }),
      status: 'selected',
    }),
  ]);
});

it.each(['success', 'failure'] as const)(
  'keeps a new upload isolated from an old %s after resetting the queue',
  async (outcome) => {
    const oldRequest = deferred<Awaited<ReturnType<typeof uploadListingImage>>>();
    const newRequest = deferred<Awaited<ReturnType<typeof uploadListingImage>>>();

    vi.mocked(uploadListingImage)
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);

    const onOldUploaded = vi.fn();
    const onNewUploaded = vi.fn();

    const { result } = renderHook(() => useImageQueue());

    act(() => {
      result.current.add([imageFile('old'), imageFile('never-started')]);
    });

    let oldUpload!: Promise<void>;

    act(() => {
      oldUpload = result.current.upload(reportId, onOldUploaded);
    });

    const oldSignal = vi.mocked(uploadListingImage).mock.calls[0][3];

    act(() => {
      result.current.reset();
    });

    expect(oldSignal?.aborted).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(result.current.busy).toBe(false);

    act(() => {
      result.current.add([imageFile('new')]);
    });

    let newUpload!: Promise<void>;

    act(() => {
      newUpload = result.current.upload(reportId, onNewUploaded);
    });

    const newItem = result.current.items[0];
    const newSignal = vi.mocked(uploadListingImage).mock.calls[1][3];

    await act(async () => {
      if (outcome === 'success') {
        oldRequest.resolve({ image: photo() });
      } else {
        oldRequest.reject(new Error('Late network error'));
      }

      await oldUpload;
    });

    expect(onOldUploaded).not.toHaveBeenCalled();
    expect(onNewUploaded).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([newItem]);
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(true);
    expect(newSignal?.aborted).toBe(false);

    await act(async () => {
      await result.current.upload(reportId, onNewUploaded);
    });

    expect(uploadListingImage).toHaveBeenCalledTimes(2);

    const uploaded = photo(1);

    await act(async () => {
      newRequest.resolve({ image: uploaded });
      await newUpload;
    });

    expect(onNewUploaded).toHaveBeenCalledExactlyOnceWith(uploaded);
    expect(result.current.items).toEqual([
      {
        ...newItem,
        status: 'uploaded',
      },
    ]);
    expect(result.current.busy).toBe(false);
  },
);

it.each(['success', 'failure'] as const)(
  'aborts on unmount and ignores a late upload %s without starting the next file',
  async (outcome) => {
    const pending = deferred<Awaited<ReturnType<typeof uploadListingImage>>>();

    vi.mocked(uploadListingImage).mockReturnValueOnce(pending.promise);

    const onUploaded = vi.fn();
    const { result, unmount } = renderHook(() => useImageQueue());

    act(() => {
      result.current.add([imageFile('first'), imageFile('second')]);
    });

    let upload!: Promise<void>;

    act(() => {
      upload = result.current.upload(reportId, onUploaded);
    });

    const signal = vi.mocked(uploadListingImage).mock.calls[0][3];

    unmount();

    expect(signal?.aborted).toBe(true);

    await act(async () => {
      if (outcome === 'success') {
        pending.resolve({ image: photo() });
      } else {
        pending.reject(new Error('Late network error'));
      }

      await upload;
    });

    expect(uploadListingImage).toHaveBeenCalledOnce();
    expect(onUploaded).not.toHaveBeenCalled();
  },
);
