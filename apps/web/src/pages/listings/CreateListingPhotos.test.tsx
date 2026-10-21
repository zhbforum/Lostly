import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { CreateListingPage } from './CreateListingPage';
import { createListing } from '@/features/listings/api/listings-api';
import { uploadListingImage } from '@/features/listings/api/listing-images-api';
import { photo } from '@/test/fixtures/listing-images';
import { ownerReport } from '@/test/fixtures/listing-management';
import { useImageQueue } from '@/features/listings/model/use-image-queue';
import { ListingUploadProgress } from '@/features/listings/ui/ListingPhotos/upload';
import { ListingCreationSuccess } from '@/features/listings/ui/ListingCreationSuccess';

vi.mock('@/features/listings/api/listings-api');
vi.mock('@/features/listings/api/listing-images-api');
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('counts successful uploads when adding replacements after a partial failure', async () => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:preview');
      static revokeObjectURL = vi.fn();
    },
  );
  vi.mocked(uploadListingImage)
    .mockResolvedValueOnce({ image: photo() })
    .mockRejectedValueOnce(new Error('offline'));
  function Progress() {
    const queue = useImageQueue();
    return (
      <>
        <button
          onClick={() => {
            queue.add([
              new File(['one'], 'one.png', { type: 'image/png' }),
              new File(['two'], 'two.png', { type: 'image/png' }),
            ]);
            void queue.upload('report');
          }}
        >
          Start
        </button>
        <ListingUploadProgress listingId="report" queue={queue} />
      </>
    );
  }
  render(<Progress />);
  const actor = userEvent.setup();
  await actor.click(screen.getByRole('button', { name: 'Start' }));
  const picker = await screen.findByLabelText('Add photos');
  await actor.upload(
    picker,
    Array.from({ length: 4 }, (_, i) => new File(['x'], `${i}.png`, { type: 'image/png' })),
  );
  expect(screen.getByText('Choose up to 5 photos in total.')).toBeInTheDocument();
  expect(screen.getByText('1 of 2 photos uploaded.')).toBeInTheDocument();
});

it('creates the report once and retries only failed photos with the same operation key', async () => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:preview');
      static revokeObjectURL = vi.fn();
    },
  );
  const report = ownerReport().listing;
  vi.mocked(createListing).mockResolvedValue({ listing: report });
  vi.mocked(uploadListingImage)
    .mockResolvedValueOnce({ image: photo() })
    .mockRejectedValueOnce(new Error('Response lost'))
    .mockResolvedValueOnce({ image: photo(1) });
  render(
    <MemoryRouter initialEntries={['/listings/new?kind=lost']}>
      <CreateListingPage />
    </MemoryRouter>,
  );
  const actor = userEvent.setup();
  await actor.type(screen.getByLabelText('Title'), 'Blue backpack');
  await actor.type(screen.getByLabelText('Description'), 'A blue backpack near the library.');
  await actor.type(screen.getByLabelText('Location'), 'Berlin library');
  await actor.type(screen.getByRole('spinbutton', { name: /month/i }), '9');
  await actor.type(screen.getByRole('spinbutton', { name: /day/i }), '1');
  await actor.type(screen.getByRole('spinbutton', { name: /year/i }), '2026');
  const files = [
    new File(['one'], 'one.png', { type: 'image/png' }),
    new File(['two'], 'two.png', { type: 'image/png' }),
  ];
  await actor.upload(screen.getByLabelText('Add photos'), files);
  await actor.click(screen.getByRole('button', { name: 'Create report' }));
  await screen.findByRole('heading', { name: 'Your report was created.' });
  await screen.findByText('1 of 2 photos uploaded.');
  await actor.click(screen.getByRole('button', { name: 'Retry failed photos' }));
  await waitFor(() => expect(screen.getByText('2 of 2 photos uploaded.')).toBeInTheDocument());
  expect(createListing).toHaveBeenCalledTimes(1);
  const calls = vi.mocked(uploadListingImage).mock.calls;
  expect(calls).toHaveLength(3);
  expect(calls[0][0]).toBe(report.id);
  expect(calls[1][1]).toBe(files[1]);
  expect(calls[2][1]).toBe(files[1]);
  expect(calls[1][2]).toBe(calls[2][2]);
  await actor.click(screen.getByRole('button', { name: 'Create another report' }));
  expect(screen.getByLabelText('Title')).toHaveValue('');
  expect(screen.getByLabelText('Description')).toHaveValue('');
  expect(screen.getByLabelText('Location')).toHaveValue('');
  expect(screen.queryByText('2 of 2 photos uploaded.')).not.toBeInTheDocument();
  expect(screen.queryByAltText(/Selected attachment/)).not.toBeInTheDocument();
  await actor.upload(
    screen.getByLabelText('Add photos'),
    new File(['new'], 'new.png', { type: 'image/png' }),
  );
  expect(screen.getAllByAltText(/Selected attachment/)).toHaveLength(1);
  expect(createListing).toHaveBeenCalledOnce();
  expect(uploadListingImage).toHaveBeenCalledTimes(3);
});

it.each(['/listings/new', '/listings/new?kind=unknown'])(
  'requires choosing a kind when opening %s',
  async (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <CreateListingPage />
      </MemoryRouter>,
    );
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Create report' }));
    expect(
      screen.getByRole('link', { name: 'Choose whether you lost or found the item.' }),
    ).toBeVisible();
    expect(createListing).not.toHaveBeenCalled();
  },
);

it('shows completed-file progress and offers View report only after uploading settles', async () => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:preview');
      static revokeObjectURL = vi.fn();
    },
  );
  let finish!: (value: { image: ReturnType<typeof photo> }) => void;
  vi.mocked(uploadListingImage)
    .mockResolvedValueOnce({ image: photo() })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  function UploadingReport() {
    const queue = useImageQueue();
    return (
      <>
        <button
          onClick={() => {
            queue.add([
              new File(['a'], 'a.png', { type: 'image/png' }),
              new File(['b'], 'b.png', { type: 'image/png' }),
            ]);
            void queue.upload('report');
          }}
        >
          Start
        </button>
        <ListingCreationSuccess
          listing={ownerReport().listing}
          uploading={queue.busy}
          onCreateAnother={vi.fn()}
        >
          <ListingUploadProgress listingId="report" queue={queue} />
        </ListingCreationSuccess>
      </>
    );
  }
  render(
    <MemoryRouter>
      <UploadingReport />
    </MemoryRouter>,
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Start' }));
  await screen.findByText('1 of 2 photos uploaded.');
  expect(screen.getByRole('progressbar', { name: 'Photos uploaded' })).toHaveAttribute(
    'value',
    '1',
  );
  expect(screen.getByRole('progressbar')).toHaveAttribute('max', '2');
  expect(screen.queryByRole('link', { name: 'View report' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Uploading photos…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Create another report' })).toBeDisabled();
  finish({ image: photo(1) });
  await screen.findByText('2 of 2 photos uploaded.');
  expect(screen.getByRole('link', { name: 'View report' })).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '2');
});
