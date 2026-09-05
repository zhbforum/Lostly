import { useCallback, useEffect, useState } from 'react';

import { getListings } from '@/features/listings/api/listings-api';
import type {
  Listing,
  ListingFeedSort,
  ListingKind,
  ListingPageInfo,
} from '@/features/listings/model/types';

export type ListingFeedState =
  | { status: 'loading' }
  | { status: 'success'; listings: Listing[]; pageInfo: ListingPageInfo }
  | { status: 'error' };

interface UseListingFeedInput {
  kind: ListingKind | undefined;
  sort: ListingFeedSort;
  cursor: string | null;
}

const LOADING_STATE = { status: 'loading' } as const satisfies ListingFeedState;

export function useListingFeed({ kind, sort, cursor }: UseListingFeedInput): {
  state: ListingFeedState;
  retry: () => void;
} {
  const [retryVersion, setRetryVersion] = useState(0);
  const [settledState, setSettledState] = useState<{
    requestKey: string;
    state: Exclude<ListingFeedState, { status: 'loading' }>;
  } | null>(null);
  const requestKey = `${kind ?? 'all'}:${sort}:${cursor ?? 'first'}:${retryVersion}`;

  useEffect(() => {
    const controller = new AbortController();

    void getListings({ kind, sort, cursor: cursor ?? undefined }, controller.signal)
      .then(({ listings, pageInfo }) => {
        if (!controller.signal.aborted) {
          setSettledState({
            requestKey,
            state: { status: 'success', listings, pageInfo },
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSettledState({ requestKey, state: { status: 'error' } });
        }
      });

    return () => controller.abort();
  }, [cursor, kind, requestKey, sort]);

  const retry = useCallback(() => {
    setRetryVersion((version) => version + 1);
  }, []);

  return {
    state: settledState?.requestKey === requestKey ? settledState.state : LOADING_STATE,
    retry,
  };
}
