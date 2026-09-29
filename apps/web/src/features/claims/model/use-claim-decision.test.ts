import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { advanceSessionGeneration } from '@/shared/api/session-events';
import { deferred } from '@/test/deferred';
import { decideClaim } from '../api/claims-api';
import type { ClaimResponse } from './types';
import { useClaimDecision } from './use-claim-decision';

vi.mock('../api/claims-api');
afterEach(() => vi.resetAllMocks());

it.each(['unmount', 'session'] as const)(
  'ignores a delayed decision after %s',
  async (boundary) => {
    const pending = deferred<ClaimResponse>();
    vi.mocked(decideClaim).mockReturnValue(pending.promise);
    const changed = vi.fn();
    const reconcile = vi.fn();
    const { result, unmount } = renderHook(() => useClaimDecision(changed, reconcile));
    let request!: Promise<boolean>;
    act(() => {
      request = result.current.submit('claim-A', { decision: 'rejected' });
    });
    await act(async () => {
      expect(await result.current.submit('claim-A', { decision: 'rejected' })).toBe(false);
    });
    if (boundary === 'unmount') unmount();
    else act(() => advanceSessionGeneration());
    await act(async () => {
      pending.resolve({ claim: { id: 'claim-A' } } as ClaimResponse);
      expect(await request).toBe(false);
    });
    expect(changed).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(decideClaim).toHaveBeenCalledTimes(1);
  },
);

it('keeps a failed decision actionable and requests server reconciliation', async () => {
  vi.mocked(decideClaim).mockRejectedValue(new TypeError('Offline'));
  const changed = vi.fn();
  const reconcile = vi.fn();
  const { result } = renderHook(() => useClaimDecision(changed, reconcile));
  await act(async () => {
    expect(await result.current.submit('claim-A', { decision: 'rejected' })).toBe(false);
  });
  expect(result.current.error).toContain('Could not save');
  expect(result.current.pendingId).toBeNull();
  expect(changed).not.toHaveBeenCalled();
  expect(reconcile).toHaveBeenCalledTimes(1);
});
