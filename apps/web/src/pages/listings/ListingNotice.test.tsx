import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getListing } from '@/features/listings/api/listings-api';
import { ownerReport, reportId } from '@/test/fixtures/listing-management';
import { ListingDetailsPage } from './ListingDetailsPage';

vi.mock('@/features/listings/api/listings-api');

describe('report update flash notice', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getListing).mockResolvedValue(ownerReport());
  });

  it('consumes history state once, preserving URL and other state across reload', async () => {
    const restState = {
      returnTo: '/activity?tab=reports',
      returnPagination: { cursors: [null, 'saved-cursor'], pageIndex: 1 },
      unrelated: { keep: true },
    };
    const originalState = { ...restState, reportNotice: 'Your report was updated.' };
    const entry = {
      pathname: `/listings/${reportId}`,
      search: '?source=activity&claimsCursor=abc',
      hash: '#claims',
      state: originalState,
    };
    const routes = [{ path: '/listings/:id', element: <ListingDetailsPage /> }];
    const router = createMemoryRouter(routes, { initialEntries: [entry] });
    const view = render(<RouterProvider router={router} />);

    try {
      expect(await screen.findByText('Your report was updated.')).toBeVisible();
      await waitFor(() => expect(router.state.location.state).toEqual(restState));
      expect(router.state.historyAction).toBe('REPLACE');
      expect(router.state.location).toMatchObject({ ...entry, state: restState });
      expect(originalState.reportNotice).toBe('Your report was updated.');
      expect(screen.getByRole('link', { name: /Back to results/ })).toHaveAttribute(
        'href',
        restState.returnTo,
      );

      // A new app instance receives only the browser's persisted history entry.
      const persistedEntry = router.state.location;

      view.unmount();

      const reloaded = createMemoryRouter(routes, { initialEntries: [persistedEntry] });
      const reloadedView = render(<RouterProvider router={reloaded} />);

      try {
        await screen.findByRole('heading', { name: ownerReport().listing.title });
        expect(screen.queryByText('Your report was updated.')).not.toBeInTheDocument();
        expect(reloaded.state.location).toMatchObject({ ...entry, state: restState });
      } finally {
        reloadedView.unmount();
        reloaded.dispose();
      }
    } finally {
      view.unmount();
      router.dispose();
    }
  });
});
