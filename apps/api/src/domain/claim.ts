import type { ListingKind } from '@/domain/listing';

export const CLAIM_STATUSES = ['pending', 'approved', 'rejected'] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_STATUS_TRANSITIONS: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> = {
  pending: ['approved', 'rejected'],
  approved: [],
  rejected: [],
};

export function isClaimableListingKind(kind: ListingKind): boolean {
  return kind === 'found';
}

export function canTransitionClaimStatus(from: ClaimStatus, to: ClaimStatus): boolean {
  return CLAIM_STATUS_TRANSITIONS[from].includes(to);
}
