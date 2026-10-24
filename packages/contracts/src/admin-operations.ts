import type { AdminListing, AdminModerationEvent } from './admin';
import type { UserProfile } from './profile';
import type { UserRole } from './auth';
import type { AccountRestriction, ModerationCase, ModerationPage } from './moderation';
import type { ClaimStatus } from './claims';
import type { ListingImage, ListingStatus } from './listings';

export interface AdminUserDetail {
  user: UserProfile & {
    email: string;
    role: UserRole;
    restriction: AccountRestriction | null;
    moderationVersion: number;
  };
  activeSessions: number;
  identities: { provider: string; createdAt: string }[];
}
export interface AdminListingDetail {
  listing: AdminListing;
  images: (ListingImage & { isHidden: boolean })[];
  claimCount: number;
}
export interface AdminClaimDetail {
  claim: {
    id: string;
    status: ClaimStatus;
    createdAt: string;
    updatedAt: string;
    reviewedAt: string | null;
    reviewerId: string | null;
    listing: {
      id: string;
      title: string;
      status: ListingStatus;
      version: number;
      isHidden: boolean;
      ownerId: string;
    };
    claimant: { id: string; displayName: string };
    conversation: { id: string; moderationClosed: boolean } | null;
  };
}
export interface AdminCaseDetail {
  reversibleListing: { id: string; version: number } | null;
  case: ModerationCase;
  related: { listingId: string | null; userId: string | null; conversationId: string | null };
  notes: ModerationPage<{ id: string; actorUserId: string; body: string; createdAt: string }>;
}
export interface AdminAuditEvent extends AdminModerationEvent {
  targetType: string;
  targetId: string;
  caseId: string | null;
  parentEventId: string | null;
  metadata: Record<string, unknown>;
}
export interface AdminEvidence {
  text: string;
  images: { id: string; width: number; height: number; url: string; expiresAt: string }[];
}
export interface AdminWorkload {
  open: number;
  inReview: number;
  mine: number;
  unassigned: number;
  overdue: number;
  appeals: number;
  restrictedUsers: number;
}
