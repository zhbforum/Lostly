import type {
  ClaimResponse,
  CreateClaimInput,
  DecideClaimInput,
  IncomingClaimsResponse,
} from '@/features/claims/model/types';
import { apiRequest } from '@/shared/api/client';

export function createClaim(listingId: string, input: CreateClaimInput): Promise<ClaimResponse> {
  return apiRequest<ClaimResponse>(`/listings/${encodeURIComponent(listingId)}/claims`, {
    method: 'POST',
    body: input,
  });
}

export function getIncomingClaims(
  listingId: string,
  signal?: AbortSignal,
  cursor?: string,
): Promise<IncomingClaimsResponse> {
  const query = cursor ? `?${new URLSearchParams({ cursor })}` : '';
  return apiRequest<IncomingClaimsResponse>(
    `/listings/${encodeURIComponent(listingId)}/claims${query}`,
    {
      signal,
    },
  );
}

export function decideClaim(claimId: string, input: DecideClaimInput): Promise<ClaimResponse> {
  return apiRequest<ClaimResponse>(`/claims/${encodeURIComponent(claimId)}`, {
    method: 'PATCH',
    body: input,
  });
}
