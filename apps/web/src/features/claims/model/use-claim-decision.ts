import { useRef, useState } from 'react';
import { decideClaim } from '@/features/claims/api/claims-api';
import type { DecideClaimInput } from '@/features/claims/model/types';
import { ApiError } from '@/shared/api/client';

export function useClaimDecision(onChanged: () => void) {
  const busy = useRef(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(id: string, input: DecideClaimInput): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setPendingId(id);
    setError(null);
    try {
      await decideClaim(id, input);
      onChanged();
      return true;
    } catch (error) {
      setError(
        error instanceof ApiError
          ? error.message
          : 'Could not save the decision. Refresh the report to check its latest status.',
      );
      return false;
    } finally {
      busy.current = false;
      setPendingId(null);
    }
  }
  return { pendingId, error, submit };
}
