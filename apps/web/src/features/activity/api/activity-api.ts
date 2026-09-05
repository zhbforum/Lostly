import type { ClaimActivityResponse } from '@lostly/contracts/claims';
import type { ListingListResponse } from '@lostly/contracts/listings';
import { apiRequest } from '@/shared/api/client';

export type ActivityTab = 'reports' | 'claims' | 'incoming';
export type ActivityResponse =
  ({ kind: 'reports' } & ListingListResponse) | ({ kind: 'claims' } & ClaimActivityResponse);

export async function getActivity(
  tab: ActivityTab,
  cursor: string | undefined,
  signal: AbortSignal,
): Promise<ActivityResponse> {
  const query = new URLSearchParams();
  if (cursor) query.set('cursor', cursor);
  if (tab === 'reports')
    return {
      kind: 'reports',
      ...(await apiRequest<ListingListResponse>(`/me/listings?${query}`, { signal })),
    };
  query.set('direction', tab === 'incoming' ? 'incoming' : 'outgoing');
  return {
    kind: 'claims',
    ...(await apiRequest<ClaimActivityResponse>(`/me/claims?${query}`, { signal })),
  };
}
