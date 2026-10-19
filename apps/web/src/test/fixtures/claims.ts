import type { Claim } from '@lostly/contracts/claims';

export function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'claim-A',
    conversationId: 'A',
    listingId: 'listing-1',
    status: 'pending',
    verificationDetails: 'A green keychain in the inside pocket.',
    createdAt: '2026-09-24T12:00:00.000Z',
    updatedAt: '2026-09-24T12:00:00.000Z',
    reviewedAt: null,
    handoverDetails: null,
    ...overrides,
  };
}
