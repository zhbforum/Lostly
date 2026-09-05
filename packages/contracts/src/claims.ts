import type { Listing } from './listings';
import type { PageInfo } from './pagination';

export const CLAIM_STATUSES = ['pending', 'approved', 'rejected'] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_DECISIONS = ['approved', 'rejected'] as const;

export type ClaimDecision = (typeof CLAIM_DECISIONS)[number];

export const CLAIM_CONSTRAINTS = {
  verificationDetailsMinLength: 10,
  verificationDetailsMaxLength: 2000,
  handoverDetailsMinLength: 10,
  handoverDetailsMaxLength: 1000,
} as const;

export interface Claim {
  id: string;
  listingId: string;
  status: ClaimStatus;
  verificationDetails: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  handoverDetails: string | null;
}

export interface IncomingClaim extends Claim {
  claimant: {
    id: string;
    displayName: string;
  };
}

export interface CreateClaimInput {
  verificationDetails: string;
}

export type DecideClaimInput =
  { decision: 'approved'; handoverDetails: string } | { decision: 'rejected' };

export interface ClaimResponse {
  claim: Claim;
}

export interface IncomingClaimsResponse {
  claims: IncomingClaim[];
  pageInfo: PageInfo;
}

export interface ClaimActivity {
  id: string;
  status: ClaimStatus;
  createdAt: string;
  listing: Pick<Listing, 'id' | 'title' | 'status'>;
}

export interface ClaimActivityResponse {
  claims: ClaimActivity[];
  pageInfo: PageInfo;
}
