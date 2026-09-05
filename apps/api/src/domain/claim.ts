import {
  CLAIM_CONSTRAINTS,
  CLAIM_DECISIONS,
  CLAIM_STATUSES,
  type ClaimDecision,
  type ClaimStatus,
} from '@lostly/contracts/claims';
import type { ListingKind } from '@/domain/listing';

export { CLAIM_CONSTRAINTS, CLAIM_DECISIONS, CLAIM_STATUSES };
export type { ClaimDecision, ClaimStatus };

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
