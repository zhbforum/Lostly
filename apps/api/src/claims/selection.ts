import { claims } from '@/db/schema';

export const claimSelection = {
  id: claims.id,
  listingId: claims.listingId,
  status: claims.status,
  verificationDetails: claims.verificationDetails,
  handoverDetails: claims.handoverDetails,
  createdAt: claims.createdAt,
  updatedAt: claims.updatedAt,
  reviewedAt: claims.reviewedAt,
};

export type ClaimRecord = Pick<typeof claims.$inferSelect, keyof typeof claimSelection>;
export type ClaimFailure =
  | 'listing-not-found'
  | 'listing-not-claimable'
  | 'cannot-claim-own-listing'
  | 'claim-already-exists'
  | 'claim-not-found'
  | 'review-forbidden'
  | 'claim-already-decided'
  | 'invalid-cursor';
export type ClaimResult<T> = { ok: true; value: T } | { ok: false; reason: ClaimFailure };
