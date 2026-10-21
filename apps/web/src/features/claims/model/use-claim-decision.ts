import { useLayoutEffect, useRef, useState } from 'react';
import { decideClaim } from '@/features/claims/api/claims-api';
import type { Claim, DecideClaimInput } from '@/features/claims/model/types';
import { ApiError } from '@/shared/api/client';
import { getSessionGeneration } from '@/shared/api/session-events';

export function useClaimDecision(onChanged: (claim: Claim) => void, onReconcile?: () => void) {
  const busy = useRef(false);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(id: string, input: DecideClaimInput): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    const generation = getSessionGeneration();
    const isCurrent = () => mounted.current && generation === getSessionGeneration();
    setPendingId(id);
    setError(null);
    try {
      const { claim } = await decideClaim(id, input);
      if (!isCurrent()) return false;
      onChanged(claim);
      return true;
    } catch (cause) {
      if (!isCurrent()) return false;
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not save the decision. Refresh the report to check its latest status.',
      );
      onReconcile?.();
      return false;
    } finally {
      busy.current = false;
      if (isCurrent()) setPendingId(null);
    }
  }
  return { pendingId, error, submit, reconcile: onReconcile, clearError: () => setError(null) };
}
