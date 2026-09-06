import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { expect, it, vi } from 'vitest';
import { useListingDetails } from '@/features/listings/model/use-listing-details';
import { ownerReport } from '@/test/fixtures/listing-management';
import { EditListingPage } from './EditListingPage';

vi.mock('@/features/listings/model/use-listing-details');

it('keeps a draft for the same version but remounts the editor when server updatedAt changes', () => {
  const report = ownerReport();
  const retry = vi.fn();
  vi.mocked(useListingDetails).mockReturnValue({
    state: { status: 'success', listing: report },
    retry,
  });
  const page = () => (
    <MemoryRouter initialEntries={[`/listings/${report.listing.id}/edit`]}>
      <Routes>
        <Route path="/listings/:id/edit" element={<EditListingPage />} />
      </Routes>
    </MemoryRouter>
  );
  const view = render(page());
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Unsaved changes' } });
  vi.mocked(useListingDetails).mockReturnValue({
    state: { status: 'success', listing: structuredClone(report) },
    retry,
  });
  view.rerender(page());
  expect(screen.getByLabelText('Title')).toHaveValue('Unsaved changes');

  const newer = {
    ...report,
    listing: {
      ...report.listing,
      title: 'New server title',
      updatedAt: '2026-09-02T10:00:00.000Z',
    },
  };
  vi.mocked(useListingDetails).mockReturnValue({
    state: { status: 'success', listing: newer },
    retry,
  });
  view.rerender(page());
  expect(screen.getByLabelText('Title')).toHaveValue(newer.listing.title);
  expect(screen.getByLabelText('Description')).toHaveValue(newer.listing.description);
});
