import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ListingPhotos } from './ListingPhotos';
import { ListingImagePicker } from './ListingImagePicker';
import { ListingCoverImage } from './ListingCoverImage';
import { useImageQueue } from '@/features/listings/model/use-image-queue';
import { getListing, updateListing } from '@/features/listings/api/listings-api';
import {
  deleteListingImage,
  orderListingImages,
  uploadListingImage,
} from '@/features/listings/api/listing-images-api';
import { EditListingPage } from '@/pages/listings/EditListingPage';
import { ownerReport, reportId } from '@/test/fixtures/listing-management';
import { photo } from '@/test/fixtures/listing-images';

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

it('previews selected files, removes them and releases object URLs', async () => {
  function Picker() {
    const queue = useImageQueue();
    return (
      <ListingImagePicker
        items={queue.items}
        error={queue.error}
        onAdd={queue.add}
        onRemove={queue.remove}
      />
    );
  }

  render(<Picker />);

  const actor = userEvent.setup();

  await actor.upload(
    screen.getByLabelText('Add photos'),
    new File(['png'], 'photo.png', { type: 'image/png' }),
  );

  expect(screen.getByAltText('Selected attachment 1')).toHaveAttribute('src', 'blob:photo-preview');

  await actor.click(screen.getByRole('button', { name: 'Remove selected photo 1' }));

  expect(screen.queryByAltText('Selected attachment 1')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-preview');
  expect(screen.getByLabelText('Add photos')).toHaveFocus();
});

it('switches gallery photos and hides management controls for a viewer', async () => {
  const images = [photo(0), photo(1)];

  render(<ListingPhotos listingId={reportId} images={images} canManage={false} />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Show photo 2' }));

  expect(screen.getByAltText('Report photo 2')).toHaveAttribute('src', images[1].url);
  expect(screen.getByRole('button', { name: 'Next photo' })).toBeDisabled();

  await userEvent.setup().click(screen.getByRole('button', { name: 'Previous photo' }));

  expect(screen.getByAltText('Report photo 1')).toHaveAttribute('src', images[0].url);
  expect(screen.getByRole('button', { name: 'Previous photo' })).toBeDisabled();
  expect(screen.queryByRole('region', { name: 'Manage photos' })).not.toBeInTheDocument();
});

it('moves the cover later and reflects the authoritative new order', async () => {
  const images = [photo(0), photo(1)];
  vi.mocked(orderListingImages).mockResolvedValue({
    images: [
      { ...images[1], position: 0 },
      { ...images[0], position: 1 },
    ],
  });

  render(<ListingPhotos listingId={reportId} images={images} canManage />);

  const actor = userEvent.setup();

  await actor.click(screen.getByText('Manage photos', { selector: 'summary span' }));
  await actor.click(screen.getByRole('button', { name: 'Move photo 1 right' }));

  expect(orderListingImages).toHaveBeenCalledExactlyOnceWith(
    reportId,
    [images[1].id, images[0].id],
    expect.any(AbortSignal),
  );
  expect(screen.getByAltText('Photo 1, cover')).toHaveAttribute('src', images[1].url);
  expect(screen.getByRole('button', { name: 'Move photo 2 right' })).toBeDisabled();
});

it('reorders and deletes saved photos, updating the cover and gallery', async () => {
  const images = [photo(0), photo(1)];
  vi.mocked(orderListingImages).mockResolvedValue({
    images: [
      { ...images[1], position: 0 },
      { ...images[0], position: 1 },
    ],
  });
  vi.mocked(deleteListingImage).mockResolvedValue(undefined);

  render(<ListingPhotos listingId={reportId} images={images} canManage />);

  const actor = userEvent.setup();

  await actor.click(screen.getByText('Manage photos', { selector: 'summary span' }));
  await actor.click(screen.getByRole('button', { name: 'Move photo 2 left' }));

  expect(orderListingImages).toHaveBeenCalledWith(
    reportId,
    [images[1].id, images[0].id],
    expect.any(AbortSignal),
  );
  expect(screen.getByAltText('Photo 1, cover')).toHaveAttribute('src', images[1].url);

  await actor.click(screen.getByRole('button', { name: 'Delete photo 1' }));

  expect(deleteListingImage).not.toHaveBeenCalled();

  await actor.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete photo' }),
  );

  expect(deleteListingImage).toHaveBeenCalledWith(reportId, images[1].id, expect.any(AbortSignal));
  expect(screen.getByAltText('Photo 1, cover')).toHaveAttribute('src', images[0].url);
  expect(screen.queryByRole('button', { name: 'Show photo 2' })).not.toBeInTheDocument();
});

it('refreshes expired URLs without discarding an unsaved text draft', async () => {
  const report = ownerReport();

  report.images = [photo()];

  vi.mocked(getListing).mockResolvedValue(report);
  vi.mocked(uploadListingImage).mockResolvedValue({ image: photo(1) });
  vi.mocked(updateListing).mockResolvedValue({ listing: report.listing });

  render(
    <MemoryRouter initialEntries={[`/listings/${reportId}/edit`]}>
      <Routes>
        <Route path="/listings/:id/edit" element={<EditListingPage />} />
        <Route path="/listings/:id" element={<p>Saved</p>} />
      </Routes>
    </MemoryRouter>,
  );

  const actor = userEvent.setup();
  const title = await screen.findByLabelText('Title');

  await actor.clear(title);
  await actor.type(title, 'My unsaved title');

  const refreshed = {
    ...report,
    images: [{ ...photo(), url: 'https://images.example.test/refreshed' }],
  };
  vi.mocked(getListing).mockResolvedValue(refreshed);

  expect(screen.queryByRole('region', { name: 'Report photos' })).not.toBeInTheDocument();

  fireEvent.error(screen.getByAltText('Photo 1, cover'));

  await waitFor(() =>
    expect(screen.getByAltText('Photo 1, cover')).toHaveAttribute('src', refreshed.images[0].url),
  );
  expect(title).toHaveValue('My unsaved title');

  await actor.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(updateListing).toHaveBeenCalledWith(
    reportId,
    expect.objectContaining({ title: 'My unsaved title', expectedVersion: 1 }),
    expect.any(AbortSignal),
  );
});

it('recovers once from a broken signed URL and then keeps a stable fallback', async () => {
  const first = photo();
  const next = { ...first, url: first.url + '2' };
  vi.mocked(getListing).mockResolvedValue({ ...ownerReport(), images: [next] });

  render(<ListingCoverImage listingId={reportId} image={first} />);
  fireEvent.error(screen.getByAltText(''));

  await waitFor(() => expect(screen.getByAltText('')).toHaveAttribute('src', next.url));

  fireEvent.error(screen.getByAltText(''));

  expect(screen.getByText('Photo unavailable')).toBeInTheDocument();
  expect(getListing).toHaveBeenCalledTimes(1);
});

it('refreshes a URL before using an expired photo collection', async () => {
  const expired = { ...photo(), urlExpiresAt: new Date(Date.now() - 1000).toISOString() };
  const fresh = { ...photo(), url: 'https://images.example.test/fresh' };
  vi.mocked(getListing).mockResolvedValue({ ...ownerReport(), images: [fresh] });

  render(<ListingPhotos listingId={reportId} images={[expired]} canManage={false} />);

  await waitFor(() =>
    expect(screen.getByAltText('Report photo 1')).toHaveAttribute('src', fresh.url),
  );
  expect(getListing).toHaveBeenCalledTimes(1);
});

it('links validation errors to the picker and explains when all slots are used', () => {
  const { rerender } = render(
    <ListingImagePicker
      items={[]}
      error="Choose up to 5 photos in total."
      onAdd={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
  const input = screen.getByLabelText('Add photos');

  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAccessibleDescription(/JPEG, PNG or WebP.*Choose up to 5 photos in total/);

  rerender(
    <ListingImagePicker
      items={[]}
      existingCount={5}
      variant="manage"
      error={null}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
    />,
  );

  expect(input).toBeDisabled();
  expect(screen.getByText('All 5 photo slots are used')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveAccessibleName('5 of 5 photo slots used');
});

it('keeps gallery controls keyboard accessible and shows which photo is selected', async () => {
  render(<ListingPhotos listingId={reportId} images={[photo(0), photo(1)]} canManage={false} />);

  const next = screen.getByRole('button', { name: 'Next photo' });

  next.focus();
  await userEvent.setup().keyboard('{Enter}');

  expect(screen.getByAltText('Report photo 2')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show photo 2' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByText('2 of 2')).toBeInTheDocument();
  expect(next).toBeDisabled();
});

it('makes a chosen photo the cover with the keyboard and restores focus to the heading', async () => {
  const images = [photo(0), photo(1), photo(2)];
  vi.mocked(orderListingImages).mockResolvedValue({
    images: [images[2], images[0], images[1]].map((image, position) => ({ ...image, position })),
  });

  render(<ListingPhotos listingId={reportId} images={images} canManage mode="edit" />);
  screen.getByRole('button', { name: 'Make photo 3 cover' }).focus();
  await userEvent.setup().keyboard('{Enter}');

  expect(orderListingImages).toHaveBeenCalledWith(
    reportId,
    [images[2].id, images[0].id, images[1].id],
    expect.any(AbortSignal),
  );
  expect(screen.getByAltText('Photo 1, cover')).toHaveAttribute('src', images[2].url);
  expect(screen.getByText('Cover photo updated.')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Your photos' })).toHaveFocus());
});

it('can cancel deleting a photo and restores focus to its trigger', async () => {
  render(<ListingPhotos listingId={reportId} images={[photo()]} canManage mode="edit" />);

  const actor = userEvent.setup();
  const trigger = screen.getByRole('button', { name: 'Delete photo 1' });

  await actor.click(trigger);

  const dialog = screen.getByRole('dialog', { name: 'Delete this photo?' });

  expect(within(dialog).getByRole('button', { name: 'Keep photo' })).toHaveFocus();

  await actor.keyboard('{Escape}');

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(deleteListingImage).not.toHaveBeenCalled();
  expect(screen.getByAltText('Photo 1, cover')).toBeInTheDocument();
});

it('keeps deletion errors inside the open dialog for recovery', async () => {
  vi.mocked(deleteListingImage).mockRejectedValue(new Error('offline'));

  render(<ListingPhotos listingId={reportId} images={[photo()]} canManage mode="edit" />);

  const actor = userEvent.setup();

  await actor.click(screen.getByRole('button', { name: 'Delete photo 1' }));

  const dialog = screen.getByRole('dialog');

  await actor.click(within(dialog).getByRole('button', { name: 'Delete photo' }));

  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Please try again.');
  expect(within(dialog).getByRole('button', { name: 'Keep photo' })).toBeEnabled();

  await actor.click(within(dialog).getByRole('button', { name: 'Keep photo' }));

  expect(screen.getByAltText('Photo 1, cover')).toBeInTheDocument();
});
