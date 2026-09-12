import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getListing, getListings } from '@/features/listings/api/listings-api';
import { ListingDetailsPage } from '@/pages/listings/ListingDetailsPage';
import { ListingFeed } from './ListingFeed';
import type { ListingSummary } from '@/features/listings/model/types';

vi.mock('@/features/listings/api/listings-api');
const listMock = vi.mocked(getListings);
const detailsMock = vi.mocked(getListing);
const item: ListingSummary = {
  coverImage: null,
  id: '550e8400-e29b-41d4-a716-446655440001',
  kind: 'found',
  status: 'active',
  version: 1,
  title: 'Blue backpack',
  description: 'Found a blue backpack.',
  location: 'Berlin',
  occurredOn: '2026-09-01',
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
};
const end = { endCursor: null, hasNextPage: false };

function renderFeed(path = '/listings') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/listings" element={<ListingFeed />} />
        <Route path="/listings/:id" element={<ListingDetailsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ListingFeed navigation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('preserves filters and cursor after viewing details and returning', async () => {
    listMock.mockImplementation(async (input) => ({
      listings: [item],
      pageInfo: input.cursor ? end : { endCursor: 'second-page', hasNextPage: true },
    }));
    detailsMock.mockResolvedValue({
      images: [],
      listing: item,
      capabilities: {
        canManageImages: false,
        canClaim: false,
        canReviewClaims: false,
        canEdit: false,
        canResolve: false,
        canArchive: false,
      },
      claim: null,
    });
    const user = userEvent.setup();
    renderFeed();
    await screen.findByRole('heading', { name: item.title });
    await user.selectOptions(screen.getByLabelText('Report type'), 'found');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'oldest');
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: item.title });
    await user.click(screen.getByRole('link', { name: /Blue backpack/ }));
    await screen.findByRole('heading', { name: item.title });
    await user.click(screen.getByRole('link', { name: /Back to results/ }));
    await screen.findByRole('heading', { name: item.title });
    expect(screen.getByLabelText('Report type')).toHaveValue('found');
    expect(screen.getByLabelText('Sort by')).toHaveValue('oldest');
    expect(listMock).toHaveBeenLastCalledWith(
      { kind: 'found', sort: 'oldest', cursor: 'second-page' },
      expect.any(AbortSignal),
    );
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(
        { kind: 'found', sort: 'oldest', cursor: undefined },
        expect.any(AbortSignal),
      ),
    );
  });

  it('can recover from an obsolete cursor without losing filters', async () => {
    listMock
      .mockRejectedValueOnce(new Error('invalid cursor'))
      .mockResolvedValue({ listings: [item], pageInfo: end });
    const user = userEvent.setup();
    renderFeed('/listings?kind=found&sort=oldest&cursor=obsolete');
    await user.click(await screen.findByRole('button', { name: 'First page' }));
    await screen.findByRole('heading', { name: item.title });
    expect(listMock).toHaveBeenLastCalledWith(
      { kind: 'found', sort: 'oldest', cursor: undefined },
      expect.any(AbortSignal),
    );
  });

  it('resets pagination when a deep-linked filter changes and permits retry', async () => {
    listMock
      .mockResolvedValueOnce({ listings: [item], pageInfo: end })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ listings: [], pageInfo: end });
    const user = userEvent.setup();
    renderFeed('/listings?kind=found&sort=oldest&cursor=second-page');
    await screen.findByRole('heading', { name: item.title });
    await user.selectOptions(screen.getByLabelText('Report type'), 'lost');
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: 'No matching active reports' });
    expect(listMock).toHaveBeenLastCalledWith(
      { kind: 'lost', sort: 'oldest', cursor: undefined },
      expect.any(AbortSignal),
    );
  });
});
