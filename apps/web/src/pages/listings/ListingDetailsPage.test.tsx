import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getListing } from '@/features/listings/api/listings-api';
import type { Listing, ListingDetailResponse } from '@/features/listings/model/types';
import { ListingDetailsPage } from '@/pages/listings/ListingDetailsPage';
import { ApiError } from '@/shared/api/client';

const { getListingMock } = vi.hoisted(() => ({
  getListingMock: vi.fn<typeof getListing>(),
}));

vi.mock('@/features/listings/api/listings-api', () => ({
  getListing: getListingMock,
}));

const LISTING_ID = '550e8400-e29b-41d4-a716-446655440000';
const SECOND_LISTING_ID = '550e8400-e29b-41d4-a716-446655440002';

const listing = {
  id: LISTING_ID,
  kind: 'lost' as const,
  status: 'active' as const,
  version: 1,
  title: 'Black backpack',
  description: 'Black backpack with a small front pocket.',
  location: 'TU Berlin',
  occurredOn: '2026-09-01',
  createdAt: '2026-09-02T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
} satisfies Listing;

const secondListing = {
  ...listing,
  id: SECOND_LISTING_ID,
  title: 'Blue umbrella',
  description: 'Blue umbrella with a wooden handle.',
} satisfies Listing;

const listingDetails = {
  listing,
  capabilities: {
    canClaim: false,
    canReviewClaims: false,
    canEdit: false,
    canResolve: false,
    canArchive: false,
  },
  claim: null,
} satisfies ListingDetailResponse;

const secondListingDetails = {
  listing: secondListing,
  capabilities: {
    canClaim: false,
    canReviewClaims: false,
    canEdit: false,
    canResolve: false,
    canArchive: false,
  },
  claim: null,
} satisfies ListingDetailResponse;

function renderPage(path = `/listings/${LISTING_ID}`, navigationTarget?: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      {navigationTarget && <Link to={navigationTarget}>Open another report</Link>}

      <Routes>
        <Route path="/listings/:id" element={<ListingDetailsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function expectFocused(element: HTMLElement) {
  await waitFor(() => {
    expect(element).toHaveFocus();
  });
}

describe('ListingDetailsPage', () => {
  beforeEach(() => {
    getListingMock.mockReset();
  });

  it('loads and displays the requested listing', async () => {
    getListingMock.mockResolvedValue(listingDetails);

    renderPage();

    expect(
      screen.getByRole('heading', {
        name: 'Opening this report',
      }),
    ).toBeInTheDocument();

    const heading = await screen.findByRole('heading', {
      name: 'Black backpack',
    });

    await expectFocused(heading);

    expect(screen.getByText('Black backpack with a small front pocket.')).toBeInTheDocument();
    expect(screen.getByText('TU Berlin')).toBeInTheDocument();
    expect(screen.getByText('September 1, 2026')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Reported September 2, 2026')).toBeInTheDocument();

    expect(getListingMock).toHaveBeenCalledTimes(1);
    expect(getListingMock.mock.calls[0]?.[0]).toBe(LISTING_ID);
    expect(getListingMock.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
  });

  it('shows a not-found state when the listing does not exist', async () => {
    getListingMock.mockRejectedValue(new ApiError(404, 'LISTING_NOT_FOUND', 'Listing not found'));

    renderPage();

    const heading = await screen.findByRole('heading', {
      name: 'We could not find this report.',
    });

    await expectFocused(heading);

    expect(screen.getByText(/link may be incorrect/i)).toBeInTheDocument();
  });

  it('shows a not-found state for an invalid listing id', async () => {
    getListingMock.mockRejectedValue(new ApiError(422, 'VALIDATION', 'Invalid listing id'));

    renderPage('/listings/not-a-uuid');

    const heading = await screen.findByRole('heading', {
      name: 'We could not find this report.',
    });

    await expectFocused(heading);

    expect(getListingMock).toHaveBeenCalledWith('not-a-uuid', expect.any(AbortSignal));
  });

  it('shows a retryable error when loading fails', async () => {
    const user = userEvent.setup();

    getListingMock
      .mockRejectedValueOnce(new Error('request failed'))
      .mockResolvedValueOnce(listingDetails);

    renderPage();

    const errorHeading = await screen.findByRole('heading', {
      name: 'We could not load this report.',
    });

    await expectFocused(errorHeading);

    await user.click(
      screen.getByRole('button', {
        name: 'Try again',
      }),
    );

    const listingHeading = await screen.findByRole('heading', {
      name: 'Black backpack',
    });

    await expectFocused(listingHeading);

    expect(getListingMock).toHaveBeenCalledTimes(2);
  });

  it('starts a new lifecycle when the listing id changes without remounting', async () => {
    const user = userEvent.setup();
    let resolveSecondRequest: ((value: ListingDetailResponse) => void) | undefined;

    getListingMock.mockImplementation((id) => {
      if (id === LISTING_ID) {
        return Promise.resolve(listingDetails);
      }

      return new Promise((resolve) => {
        resolveSecondRequest = resolve;
      });
    });

    renderPage(`/listings/${LISTING_ID}`, `/listings/${SECOND_LISTING_ID}`);

    const firstHeading = await screen.findByRole('heading', {
      name: 'Black backpack',
    });

    await expectFocused(firstHeading);

    await user.click(
      screen.getByRole('link', {
        name: 'Open another report',
      }),
    );

    await waitFor(() => {
      expect(getListingMock).toHaveBeenCalledWith(SECOND_LISTING_ID, expect.any(AbortSignal));
    });

    expect(
      screen.queryByRole('heading', {
        name: 'Black backpack',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Opening this report',
      }),
    ).toBeInTheDocument();

    resolveSecondRequest?.(secondListingDetails);

    const secondHeading = await screen.findByRole('heading', {
      name: 'Blue umbrella',
    });

    await expectFocused(secondHeading);
  });

  it('aborts the previous request when the listing id changes', async () => {
    const user = userEvent.setup();
    let resolveFirstRequest: ((value: ListingDetailResponse) => void) | undefined;
    let resolveSecondRequest: ((value: ListingDetailResponse) => void) | undefined;

    getListingMock.mockImplementation(
      (id) =>
        new Promise((resolve) => {
          if (id === LISTING_ID) {
            resolveFirstRequest = resolve;
            return;
          }

          resolveSecondRequest = resolve;
        }),
    );

    renderPage(`/listings/${LISTING_ID}`, `/listings/${SECOND_LISTING_ID}`);

    await waitFor(() => {
      expect(getListingMock).toHaveBeenCalledTimes(1);
    });

    const firstSignal = getListingMock.mock.calls[0]?.[1] as AbortSignal;

    expect(firstSignal.aborted).toBe(false);

    await user.click(
      screen.getByRole('link', {
        name: 'Open another report',
      }),
    );

    await waitFor(() => {
      expect(getListingMock).toHaveBeenCalledTimes(2);
    });

    expect(firstSignal.aborted).toBe(true);

    resolveFirstRequest?.(listingDetails);
    resolveSecondRequest?.(secondListingDetails);

    const secondHeading = await screen.findByRole('heading', {
      name: 'Blue umbrella',
    });

    await expectFocused(secondHeading);
  });

  it('aborts the request when the page unmounts', async () => {
    let resolveRequest: ((value: ListingDetailResponse) => void) | undefined;

    getListingMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const { unmount } = renderPage();

    await waitFor(() => {
      expect(getListingMock).toHaveBeenCalledTimes(1);
    });

    const signal = getListingMock.mock.calls[0]?.[1] as AbortSignal;

    expect(signal.aborted).toBe(false);

    unmount();

    expect(signal.aborted).toBe(true);

    resolveRequest?.(listingDetails);
  });
});
