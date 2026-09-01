import { describe, expect, test } from 'bun:test';

import { canTransitionClaimStatus, isClaimableListingKind } from '@/domain/claim';

describe('isClaimableListingKind', () => {
  test('allows claims for found listings', () => {
    expect(isClaimableListingKind('found')).toBe(true);
  });

  test('rejects claims for lost listings', () => {
    expect(isClaimableListingKind('lost')).toBe(false);
  });
});

describe('canTransitionClaimStatus', () => {
  test('allows pending claims to be approved', () => {
    expect(canTransitionClaimStatus('pending', 'approved')).toBe(true);
  });

  test('allows pending claims to be rejected', () => {
    expect(canTransitionClaimStatus('pending', 'rejected')).toBe(true);
  });

  test('does not allow approved claims to transition', () => {
    expect(canTransitionClaimStatus('approved', 'pending')).toBe(false);
    expect(canTransitionClaimStatus('approved', 'rejected')).toBe(false);
  });

  test('does not allow rejected claims to transition', () => {
    expect(canTransitionClaimStatus('rejected', 'pending')).toBe(false);
    expect(canTransitionClaimStatus('rejected', 'approved')).toBe(false);
  });

  test('does not allow transition to the same status', () => {
    expect(canTransitionClaimStatus('pending', 'pending')).toBe(false);
    expect(canTransitionClaimStatus('approved', 'approved')).toBe(false);
    expect(canTransitionClaimStatus('rejected', 'rejected')).toBe(false);
  });
});
