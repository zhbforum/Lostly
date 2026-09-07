import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getListing } from '@/features/listings/api/listings-api';
import { createClaim, decideClaim, getIncomingClaims } from '@/features/claims/api/claims-api';
import type { ListingDetailResponse } from '@lostly/contracts/listings';
import type { IncomingClaim } from '@lostly/contracts/claims';
import { ListingDetailsPage } from './ListingDetailsPage';

vi.mock('@/features/listings/api/listings-api');
vi.mock('@/features/claims/api/claims-api');
const details = vi.mocked(getListing);
const incoming = vi.mocked(getIncomingClaims);
const decision = vi.mocked(decideClaim);
const id = '550e8400-e29b-41d4-a716-446655440001';
const ownerDetails: ListingDetailResponse = {
  listing: {
    id,
    kind: 'found',
    status: 'active',
    version: 1,
    title: 'Blue backpack',
    description: 'Found backpack',
    location: 'Berlin',
    occurredOn: '2026-09-01',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  },
  capabilities: {
    canReviewClaims: true,
    canClaim: false,
    canEdit: true,
    canResolve: true,
    canArchive: true,
  },
  claim: null,
};
const claim: IncomingClaim = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  listingId: id,
  status: 'pending',
  verificationDetails: 'Red notebook in the inside pocket.',
  handoverDetails: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  reviewedAt: null,
  claimant: { id: '550e8400-e29b-41d4-a716-446655440003', displayName: 'Alex' },
};
const end = { endCursor: null, hasNextPage: false };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/listings/' + id]}>
      <Routes>
        <Route path="/listings/:id" element={<ListingDetailsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function ReturnedFeed() {
  const location = useLocation();
  return (
    <output aria-label="Restored feed">
      {JSON.stringify({ search: location.search, pagination: location.state?.pagination })}
    </output>
  );
}

describe('listing claims flow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires collection instructions and refreshes the listing after approval', async () => {
    const approved = {
      ...claim,
      status: 'approved' as const,
      handoverDetails: 'Collect from the library reception.',
    };
    details.mockResolvedValueOnce(ownerDetails).mockResolvedValue({
      ...ownerDetails,
      listing: { ...ownerDetails.listing, status: 'resolved' },
      capabilities: { ...ownerDetails.capabilities, canEdit: false, canResolve: false },
    });
    incoming
      .mockResolvedValueOnce({ claims: [claim], pageInfo: end })
      .mockResolvedValue({ claims: [approved], pageInfo: end });
    decision.mockResolvedValue({ claim: approved });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Approve claim' }));
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));
    expect(decision).not.toHaveBeenCalled();
    await user.type(
      screen.getByLabelText('Private collection instructions'),
      approved.handoverDetails,
    );
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));
    await screen.findByText('Resolved');
    await screen.findByText(approved.handoverDetails);
    expect(decision).toHaveBeenCalledWith(claim.id, {
      decision: 'approved',
      handoverDetails: approved.handoverDetails,
    });
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve claim' })).not.toBeInTheDocument();
  });

  it('shows a newly submitted claim and fetches its later decision', async () => {
    const approved = {
      ...claim,
      status: 'approved' as const,
      handoverDetails: 'Collect from library reception.',
    };
    const viewer = {
      canReviewClaims: false,
      canClaim: true,
      canEdit: false,
      canResolve: false,
      canArchive: false,
    };
    details
      .mockResolvedValueOnce({ ...ownerDetails, capabilities: viewer })
      .mockResolvedValueOnce({
        ...ownerDetails,
        capabilities: { ...viewer, canClaim: false },
        claim,
      })
      .mockResolvedValue({
        ...ownerDetails,
        listing: { ...ownerDetails.listing, status: 'resolved' },
        capabilities: { ...viewer, canClaim: false },
        claim: approved,
      });
    vi.mocked(createClaim).mockResolvedValue({ claim });
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText(/Proof of ownership/), claim.verificationDetails);
    await user.click(screen.getByRole('button', { name: 'Submit private claim' }));
    await screen.findByText('Your claim is awaiting review');
    await user.click(screen.getByRole('button', { name: 'Refresh status' }));
    await screen.findByText('Your claim was approved');
    expect(screen.getByText(approved.handoverDetails)).toBeInTheDocument();
    expect(incoming).not.toHaveBeenCalled();
  });

  it('does not show claim controls or private proof to an unrelated viewer', async () => {
    details.mockResolvedValue({
      ...ownerDetails,
      capabilities: {
        canClaim: false,
        canReviewClaims: false,
        canEdit: false,
        canResolve: false,
        canArchive: false,
      },
      claim: null,
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Blue backpack' });
    expect(screen.queryByText(claim.verificationDetails)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve claim' })).not.toBeInTheDocument();
    await waitFor(() => expect(incoming).not.toHaveBeenCalled());
  });

  it('keeps feed pagination separate from incoming claims pagination', async () => {
    details.mockResolvedValue(ownerDetails);
    incoming
      .mockResolvedValueOnce({
        claims: [claim],
        pageInfo: { endCursor: 'claims-page-two', hasNextPage: true },
      })
      .mockResolvedValue({ claims: [claim], pageInfo: end });
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/listings/' + id,
            state: {
              returnTo: '/listings?kind=found&cursor=feed-page-three',
              returnPagination: [null, 'feed-page-two'],
            },
          },
        ]}
      >
        <Routes>
          <Route path="/listings/:id" element={<ListingDetailsPage />} />
          <Route path="/listings" element={<ReturnedFeed />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(incoming).toHaveBeenLastCalledWith(id, expect.any(AbortSignal), 'claims-page-two'),
    );
    await user.click(screen.getByRole('link', { name: /Back to results/ }));
    expect(screen.getByLabelText('Restored feed')).toHaveTextContent(
      JSON.stringify({
        search: '?kind=found&cursor=feed-page-three',
        pagination: [null, 'feed-page-two'],
      }),
    );
  });
});
