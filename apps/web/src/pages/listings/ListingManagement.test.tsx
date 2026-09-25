import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archiveListing,
  getListing,
  resolveListing,
  updateListing,
} from '@/features/listings/api/listings-api';
import { getIncomingClaims } from '@/features/claims/api/claims-api';
import { ApiError } from '@/shared/api/client';
import { ListingDetailsPage } from './ListingDetailsPage';
import { EditListingPage } from './EditListingPage';
import { ownerReport, reportId } from '@/test/fixtures/listing-management';

vi.mock('@/features/listings/api/listings-api');
vi.mock('@/features/claims/api/claims-api');
const details = vi.mocked(getListing);
const resolve = vi.mocked(resolveListing);
const archive = vi.mocked(archiveListing);

function renderPage(edit = false) {
  return render(
    <MemoryRouter initialEntries={[`/listings/${reportId}${edit ? '/edit' : ''}`]}>
      <Routes>
        <Route path="/listings/:id" element={<ListingDetailsPage />} />
        <Route path="/listings/:id/edit" element={<EditListingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('listing owner management', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(['active', 'resolved', 'archived'] as const)(
    'shows owner actions for %s',
    async (status) => {
      details.mockResolvedValue(ownerReport(status));
      renderPage();
      await screen.findByRole('heading', { name: 'Blue backpack' });
      expect(Boolean(screen.queryByRole('link', { name: 'Edit report' }))).toBe(
        status === 'active',
      );
      expect(Boolean(screen.queryByRole('button', { name: 'Mark as resolved' }))).toBe(
        status === 'active',
      );
      expect(Boolean(screen.queryByRole('button', { name: 'Archive report' }))).toBe(
        status !== 'archived',
      );
    },
  );

  it('does not render owner controls for another viewer', async () => {
    details.mockResolvedValue({
      ...ownerReport(),
      capabilities: {
        canManageImages: false,
        canClaim: false,
        canReviewClaims: false,
        canEdit: false,
        canResolve: false,
        canArchive: false,
      },
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Blue backpack' });
    expect(screen.queryByRole('heading', { name: 'Your report' })).not.toBeInTheDocument();
  });

  it.each(['Mark as resolved', 'Archive report'])(
    'confirms %s accessibly and supports cancel/Escape',
    async (label) => {
      details.mockResolvedValue(ownerReport());
      const user = userEvent.setup();
      renderPage();
      const trigger = await screen.findByRole('button', { name: label });
      await user.click(trigger);
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText(/Any pending claims will be closed/)).toBeVisible();
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(trigger).toHaveFocus());
      await user.click(trigger);
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
      expect(resolve).not.toHaveBeenCalled();
      expect(archive).not.toHaveBeenCalled();
    },
  );

  it.each(['resolve', 'archive'] as const)(
    '%s refreshes status, capabilities and incoming claims',
    async (action) => {
      const initial = ownerReport();
      initial.listing.kind = 'found';
      initial.capabilities.canReviewClaims = true;
      const closed = ownerReport(action === 'resolve' ? 'resolved' : 'archived');
      closed.listing.kind = 'found';
      closed.capabilities.canReviewClaims = true;
      details.mockResolvedValueOnce(initial).mockResolvedValue(closed);
      const claim = {
        id: 'claim-one',
        conversationId: 'conversation-one',
        listingId: reportId,
        status: 'pending' as const,
        verificationDetails: 'Private identifying details.',
        handoverDetails: null,
        reviewedAt: null,
        createdAt: initial.listing.createdAt,
        updatedAt: initial.listing.updatedAt,
        claimant: { id: 'claimant', displayName: 'Alex' },
      };
      vi.mocked(getIncomingClaims)
        .mockResolvedValueOnce({
          claims: [claim],
          pageInfo: { hasNextPage: false, endCursor: null },
        })
        .mockResolvedValue({
          claims: [{ ...claim, status: 'rejected' }],
          pageInfo: { hasNextPage: false, endCursor: null },
        });
      const mutation = action === 'resolve' ? resolve : archive;
      mutation.mockResolvedValue({ listing: closed.listing });
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole('button', { name: 'Approve claim' });
      const label = action === 'resolve' ? 'Mark as resolved' : 'Archive report';
      await user.click(screen.getByRole('button', { name: label }));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: label }));
      await screen.findByText(action === 'resolve' ? 'Resolved' : 'Archived', { exact: true });
      await waitFor(() => expect(getIncomingClaims).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole('button', { name: 'Approve claim' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Edit report' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Mark as resolved' })).not.toBeInTheDocument();
      expect(Boolean(screen.queryByRole('button', { name: 'Archive report' }))).toBe(
        action === 'resolve',
      );
      expect(mutation).toHaveBeenCalledWith(reportId);
      expect(screen.getByRole('heading', { name: 'Blue backpack' })).toHaveFocus();
    },
  );

  it('keeps errors in the confirmation and allows retry', async () => {
    details.mockResolvedValue(ownerReport());
    archive.mockRejectedValue(new Error('Offline'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Archive report' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive report' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not confirm the change');
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive report' }),
    ).toBeEnabled();
    expect(details).toHaveBeenCalledTimes(1);
  });

  it('blocks duplicate actions while the request is pending', async () => {
    details.mockResolvedValueOnce(ownerReport()).mockResolvedValue(ownerReport('resolved'));
    let finish!: (value: { listing: ReturnType<typeof ownerReport>['listing'] }) => void;
    resolve.mockImplementation(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Mark as resolved' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark as resolved' }),
    );
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(resolve).toHaveBeenCalledTimes(1);
    await act(async () => finish({ listing: ownerReport('resolved').listing }));
    await screen.findByText('Resolved', { exact: true });
  });

  it('handles a stale resolve by refreshing current server capabilities', async () => {
    details.mockResolvedValueOnce(ownerReport()).mockResolvedValue(ownerReport('archived'));
    resolve.mockRejectedValue(new ApiError(409, 'LISTING_NOT_RESOLVABLE', 'Already closed'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Mark as resolved' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark as resolved' }),
    );
    await screen.findByText('Archived', { exact: true });
    expect(screen.getByRole('status')).toHaveTextContent(
      'This report changed while you were viewing it.',
    );
    expect(screen.queryByRole('button', { name: 'Archive report' })).not.toBeInTheDocument();
  });

  it('opens edit and returns to refreshed details after saving', async () => {
    const edited = ownerReport();
    edited.listing.title = 'Edited backpack';
    details
      .mockResolvedValueOnce(ownerReport())
      .mockResolvedValueOnce(ownerReport())
      .mockResolvedValue(edited);
    vi.mocked(updateListing).mockResolvedValue({ listing: edited.listing });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('link', { name: 'Edit report' }));
    await screen.findByRole('heading', { name: 'Edit report' });
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), edited.listing.title);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('heading', { name: 'Edited backpack' });
    expect(screen.getByText('Your report was updated.')).toHaveAttribute('role', 'status');
    expect(details).toHaveBeenCalledTimes(3);
  });

  it('stays on the new page when a PATCH finishes after leaving the editor', async () => {
    const report = ownerReport();
    details.mockResolvedValue(report);
    let finish!: (value: { listing: typeof report.listing }) => void;
    vi.mocked(updateListing).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/listings/${reportId}/edit`]}>
        <Link to="/elsewhere">Leave editor</Link>
        <Routes>
          <Route path="/listings/:id/edit" element={<EditListingPage />} />
          <Route path="/listings/:id" element={<ListingDetailsPage />} />
          <Route path="/elsewhere" element={<h1>Another page</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Save changes' }));
    await user.click(screen.getByRole('link', { name: 'Leave editor' }));
    expect(screen.getByRole('heading', { name: 'Another page' })).toBeVisible();
    await act(async () =>
      finish({ listing: { ...report.listing, version: report.listing.version + 1 } }),
    );
    expect(screen.getByRole('heading', { name: 'Another page' })).toBeVisible();
    expect(screen.queryByText('Your report was updated.')).not.toBeInTheDocument();
    expect(details).toHaveBeenCalledTimes(1);
  });

  it.each(['resolved', 'archived'] as const)(
    'does not offer an edit form for %s',
    async (status) => {
      details.mockResolvedValue(ownerReport(status));
      renderPage(true);
      await screen.findByRole('heading', { name: 'This report is not available for editing' });
      expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    },
  );

  it('uses the edit capability to prevent editing another owner report', async () => {
    details.mockResolvedValue({
      ...ownerReport(),
      capabilities: {
        canManageImages: false,
        canClaim: false,
        canReviewClaims: false,
        canEdit: false,
        canResolve: false,
        canArchive: false,
      },
    });
    renderPage(true);
    await screen.findByRole('heading', { name: 'This report is not available for editing' });
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });

  it('returns to current details after an edit conflicts with another tab', async () => {
    details.mockResolvedValueOnce(ownerReport()).mockResolvedValue(ownerReport('resolved'));
    vi.mocked(updateListing).mockRejectedValue(
      new ApiError(409, 'LISTING_NOT_EDITABLE', 'Not editable'),
    );
    const user = userEvent.setup();
    renderPage(true);
    await user.click(await screen.findByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('status has changed');
    await user.click(screen.getByRole('link', { name: 'Back to report' }));
    await screen.findByText('Resolved', { exact: true });
    expect(screen.queryByRole('link', { name: 'Edit report' })).not.toBeInTheDocument();
  });
});
