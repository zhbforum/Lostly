import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { uploadListingImage } from '@/features/listings/api/listing-images-api';
import { photo } from '@/test/fixtures/listing-images';
import { reportId } from '@/test/fixtures/listing-management';
import { useImageQueue } from './use-image-queue';

vi.mock('@/features/listings/api/listing-images-api');
beforeEach(() => vi.resetAllMocks());

it('retains create progress by default and explicitly discards only completed files', async () => {
  vi.mocked(uploadListingImage)
    .mockResolvedValueOnce({ image: photo() })
    .mockRejectedValueOnce(new Error('offline'));
  const { result } = renderHook(() => useImageQueue());
  const files = ['a', 'b'].map((name) => new File([name], `${name}.png`, { type: 'image/png' }));
  act(() => result.current.add(files));
  await act(async () => result.current.upload(reportId));
  expect(result.current.items.map((item) => item.status)).toEqual(['uploaded', 'failed']);
  const failed = result.current.items[1];
  act(() => expect(result.current.discardUploaded()).toBe(1));
  expect(result.current.items).toEqual([failed]);
  expect(result.current.items[0]).toBe(failed);
  expect(result.current.items.some((item) => item.file === files[0])).toBe(false);
  act(() => expect(result.current.discardUploaded()).toBe(0));
  expect(result.current.items[0]).toBe(failed);
});
