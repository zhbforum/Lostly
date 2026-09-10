import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveListing, getListing, resolveListing } from '@/features/listings/api/listings-api';
import { ApiError } from '@/shared/api/client';
import { ownerReport } from '@/test/fixtures/listing-management';
import { ListingDetailsPage } from './ListingDetailsPage';

vi.mock('@/features/listings/api/listings-api');

describe.each(['resolve', 'archive'] as const)('delayed %s after report navigation', (action) => {
  beforeEach(() => vi.resetAllMocks());

  it.each(['success', '409'] as const)(
    'ignores the old %s response without refreshing the new report or closing its dialog',
    async (outcome) => {
      const first = ownerReport();
      const second = ownerReport();
      second.listing.id = '550e8400-e29b-41d4-a716-446655440002';
      second.listing.title = 'Second report';
      vi.mocked(getListing).mockImplementation(async (id) => {
        if (id === first.listing.id) return first;
        if (id === second.listing.id) return second;
        throw new Error('Unexpected report');
      });
      const mutation = vi.mocked(action === 'resolve' ? resolveListing : archiveListing);
      let finish!: () => void;
      mutation.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            finish = () => {
              if (outcome === 'success') {
                resolve({
                  listing: ownerReport(action === 'resolve' ? 'resolved' : 'archived').listing,
                });
              } else {
                reject(
                  new ApiError(
                    409,
                    action === 'resolve' ? 'LISTING_NOT_RESOLVABLE' : 'LISTING_ALREADY_ARCHIVED',
                    'Already closed',
                  ),
                );
              }
            };
          }),
      );
      const router = createMemoryRouter(
        [{ path: '/listings/:id', element: <ListingDetailsPage /> }],
        { initialEntries: [`/listings/${first.listing.id}`] },
      );
      const view = render(<RouterProvider router={router} />);
      const user = userEvent.setup();
      const label = action === 'resolve' ? 'Mark as resolved' : 'Archive report';
      try {
        await user.click(await screen.findByRole('button', { name: label }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: label }));
        expect(mutation).toHaveBeenCalledWith(first.listing.id);
        expect(
          within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
        ).toBeDisabled();

        // Browser navigation can leave a report even while its modal is busy.
        await act(async () => {
          await router.navigate(`/listings/${second.listing.id}`);
        });
        await screen.findByRole('heading', { name: second.listing.title });
        await user.click(screen.getByRole('button', { name: 'Archive report' }));
        const secondDialog = screen.getByRole('dialog');
        const cancel = within(secondDialog).getByRole('button', { name: 'Cancel' });
        expect(cancel).toHaveFocus();
        expect(getListing).toHaveBeenCalledTimes(2);

        // Settle A only after B has loaded and its confirmation is already open.
        await act(async () => finish());
        expect(getListing).toHaveBeenCalledTimes(2);
        expect(router.state.location.pathname).toBe(`/listings/${second.listing.id}`);
        expect(screen.getByRole('dialog')).toBe(secondDialog);
        expect(cancel).toHaveFocus();
        expect(cancel).toBeEnabled();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(mutation).toHaveBeenCalledTimes(1);
      } finally {
        view.unmount();
        router.dispose();
      }
    },
  );
});
