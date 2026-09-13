import type { AuthUser } from './auth';
import type { ClaimStatus } from './claims';
import type { Listing } from './listings';
import type { PageInfo } from './pagination';

export interface AdminOverview {
  users: number;
  listings: number;
  activeListings: number;
  pendingClaims: number;
}

export interface AdminListing extends Listing {
  owner: { id: string; displayName: string };
}

export interface AdminUser extends AuthUser {
  createdAt: string;
}

// Moderation summaries do not expose ownership proof or handover instructions.
export interface AdminClaim {
  id: string;
  status: ClaimStatus;
  createdAt: string;
  listing: { id: string; title: string; status: Listing['status'] };
  claimant: { id: string; displayName: string };
}

export interface AdminPage<T> {
  items: T[];
  pageInfo: PageInfo;
}

export interface ModerationInput {
  reason: string;
}

export interface ArchiveListingInput extends ModerationInput {
  expectedVersion: number;
}
