import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getListing } from '@/features/listings/api/listings-api';
import {
  deleteListingImage,
  orderListingImages,
  uploadListingImage,
} from '@/features/listings/api/listing-images-api';
import { deferred } from '@/test/deferred';
import { photo } from '@/test/fixtures/listing-images';
import { ownerReport, reportId } from '@/test/fixtures/listing-management';
import { ListingPhotos } from './ListingPhotos';

vi.mock('@/features/listings/api/listings-api');
vi.mock('@/features/listings/api/listing-images-api');

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:photo-preview');
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('uploads to an existing report and starts a fresh queue after delete and replacement', async () => {
  const first = photo(1);
  const replacement = { ...photo(2), position: 1 };
  const pending = deferred<Awaited<ReturnType<typeof uploadListingImage>>>();
  vi.mocked(uploadListingImage)
    .mockResolvedValueOnce({ image: first })
    .mockReturnValueOnce(pending.promise);
  vi.mocked(deleteListingImage).mockResolvedValue(undefined);
  render(<ListingPhotos listingId={reportId} images={[photo()]} canManage mode="edit" />);
  const actor = userEvent.setup();
  const input = screen.getByLabelText('Add photos');
  const fileA = new File(['a'], 'a.png', { type: 'image/png' });
  const fileB = new File(['b'], 'b.png', { type: 'image/png' });

  await actor.upload(input, fileA);
  expect(screen.getByAltText('Selected photo 1')).toBeInTheDocument();
  await actor.click(screen.getByRole('button', { name: 'Upload photos' }));
  await waitFor(() => expect(screen.getByAltText('Photo 2')).toHaveAttribute('src', first.url));
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Selected photos' })).not.toBeInTheDocument();
  expect(screen.getByText('Photo uploaded.')).toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status', { name: '2 of 5 photo slots used' })).toBeInTheDocument();

  await actor.click(screen.getByRole('button', { name: 'Delete photo 2' }));
  await actor.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete photo' }),
  );
  await waitFor(() => expect(screen.queryByAltText('Photo 2')).not.toBeInTheDocument());
  await actor.upload(input, fileB);
  expect(screen.getByText('0 of 1 photos uploaded.')).toBeInTheDocument();
  await actor.click(screen.getByRole('button', { name: 'Upload photos' }));
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0');
  expect(screen.getByRole('progressbar')).toHaveAttribute('max', '1');
  expect(input).toBeDisabled();
  await act(async () => pending.resolve({ image: replacement }));
  expect(screen.getByAltText('Photo 2')).toHaveAttribute('src', replacement.url);
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.getByText('Photo uploaded.')).toBeInTheDocument();
  expect(input).toBeEnabled();
  expect(uploadListingImage).toHaveBeenCalledTimes(2);
  expect(uploadListingImage).toHaveBeenNthCalledWith(
    1,
    reportId,
    fileA,
    expect.any(String),
    expect.any(AbortSignal),
  );
  expect(uploadListingImage).toHaveBeenNthCalledWith(
    2,
    reportId,
    fileB,
    expect.any(String),
    expect.any(AbortSignal),
  );
});

it('discards successful files but preserves failed files and operation keys for retry', async () => {
  const files = ['a', 'b', 'c'].map(
    (name) => new File([name], `${name}.png`, { type: 'image/png' }),
  );
  vi.mocked(uploadListingImage)
    .mockResolvedValueOnce({ image: photo(1) })
    .mockRejectedValueOnce(new Error('Response lost'))
    .mockResolvedValueOnce({ image: photo(2) })
    .mockResolvedValueOnce({ image: photo(3) });
  render(<ListingPhotos listingId={reportId} images={[photo()]} canManage mode="edit" />);
  const actor = userEvent.setup();
  await actor.upload(screen.getByLabelText('Add photos'), files);
  await actor.click(screen.getByRole('button', { name: 'Upload photos' }));
  expect(screen.getByText('2 photos uploaded.')).toBeInTheDocument();
  expect(screen.getByText('0 of 1 photos uploaded.')).toBeInTheDocument();
  expect(
    within(screen.getByRole('list', { name: 'Selected photos' })).getAllByRole('listitem'),
  ).toHaveLength(1);
  expect(screen.getByRole('status', { name: '4 of 5 photo slots used' })).toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  await actor.click(screen.getByRole('button', { name: 'Retry failed photos' }));
  expect(screen.getByText('Photo uploaded.')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Selected photos' })).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(
    within(screen.getByRole('list', { name: 'Saved photos' })).getAllByRole('listitem'),
  ).toHaveLength(4);
  const calls = vi.mocked(uploadListingImage).mock.calls;
  expect(calls).toHaveLength(4);
  expect(calls[1][1]).toBe(files[1]);
  expect(calls[3][1]).toBe(files[1]);
  expect(calls[3][2]).toBe(calls[1][2]);
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
});

it('does not move focus to the heading when changing the cover fails', async () => {
  vi.mocked(orderListingImages).mockRejectedValue(new Error('offline'));
  render(<ListingPhotos listingId={reportId} images={[photo(), photo(1)]} canManage mode="edit" />);
  const trigger = screen.getByRole('button', { name: 'Make photo 2 cover' });
  trigger.focus();
  await userEvent.setup().keyboard('{Enter}');
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again.');
  expect(trigger).toHaveFocus();
  expect(screen.getByAltText('Photo 1, cover')).toHaveAttribute('src', photo().url);
});

it('does not show a reload error when a successful mutation cancels manual recovery', async () => {
  const pending = deferred<Awaited<ReturnType<typeof getListing>>>();
  vi.mocked(getListing).mockImplementationOnce((_id, signal) => {
    signal?.addEventListener(
      'abort',
      () => {
        pending.reject(new DOMException('The request was aborted.', 'AbortError'));
      },
      { once: true },
    );
    return pending.promise;
  });
  const images = [photo(), photo(1)];
  vi.mocked(orderListingImages)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({
      images: [images[1], images[0]].map((image, position) => ({ ...image, position })),
    });
  render(<ListingPhotos listingId={reportId} images={images} canManage mode="edit" />);
  const actor = userEvent.setup();
  await actor.click(screen.getByRole('button', { name: 'Make photo 2 cover' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Please try again.');
  await actor.click(screen.getByRole('button', { name: 'Reload photos' }));
  expect(getListing).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert')).toHaveTextContent('Please try again.');
  await actor.click(screen.getByRole('button', { name: 'Make photo 2 cover' }));
  expect(vi.mocked(getListing).mock.calls[0][1]?.aborted).toBe(true);
  expect(screen.getByAltText('Photo 1, cover')).toHaveAttribute('src', images[1].url);
  expect(screen.getByText('Cover photo updated.')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it.each(['success', 'failure'] as const)(
  'waits for an automatic refresh before handling manual reload: %s',
  async (outcome) => {
    const pending = deferred<Awaited<ReturnType<typeof getListing>>>();
    vi.mocked(getListing).mockReturnValue(pending.promise);
    vi.mocked(orderListingImages).mockRejectedValue(new Error('offline'));
    render(
      <ListingPhotos listingId={reportId} images={[photo(), photo(1)]} canManage mode="edit" />,
    );
    const actor = userEvent.setup();
    fireEvent.error(screen.getByAltText('Photo 1, cover'));
    expect(getListing).toHaveBeenCalledTimes(1);
    await actor.click(screen.getByRole('button', { name: 'Make photo 2 cover' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please try again.');
    await actor.click(screen.getByRole('button', { name: 'Reload photos' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please try again.');
    expect(getListing).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (outcome === 'success') {
        pending.resolve({ ...ownerReport(), images: [photo(), photo(1)] });
      } else {
        pending.reject(new Error('offline'));
      }
    });
    if (outcome === 'success') {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } else {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not reload photos. Please try again.',
      );
    }
  },
);
