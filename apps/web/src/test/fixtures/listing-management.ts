import type { ListingDetailResponse, ListingStatus } from '@/features/listings/model/types';

export const reportId = '550e8400-e29b-41d4-a716-446655440001';
export function ownerReport(status: ListingStatus = 'active'): ListingDetailResponse {
  return {
    listing: {
      id: reportId,
      kind: 'lost',
      status,
      version: 1,
      title: 'Blue backpack',
      description: 'A blue backpack with a red zip.',
      location: 'Berlin library',
      occurredOn: '2026-09-01',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    },
    capabilities: {
      canClaim: false,
      canReviewClaims: false,
      canEdit: status === 'active',
      canResolve: status === 'active',
      canArchive: status !== 'archived',
    },
    claim: null,
  };
}
