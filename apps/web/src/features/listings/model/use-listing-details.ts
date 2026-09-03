import { useCallback, useEffect, useState } from 'react';

import { getListing } from '@/features/listings/api/listings-api';
import type { Listing } from '@/features/listings/model/types';
import { ApiError } from '@/shared/api/client';

export type ListingDetailsState =
  | {
      status: 'loading';
    }
  | {
      status: 'success';
      listing: Listing;
    }
  | {
      status: 'not-found';
    }
  | {
      status: 'error';
    };

interface SettledListingDetailsState {
  requestKey: string;
  state: Exclude<ListingDetailsState, { status: 'loading' }>;
}

const LOADING_STATE = {
  status: 'loading',
} as const satisfies ListingDetailsState;

const NOT_FOUND_STATE = {
  status: 'not-found',
} as const satisfies ListingDetailsState;

function isUnavailableListingError(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }

  // A missing record and a malformed id differ at the API level, but both mean
  // that the referenced report is unavailable in the page experience.
  return (error.status === 404 && error.code === 'LISTING_NOT_FOUND') || error.status === 422;
}

export function useListingDetails(id: string | undefined): {
  state: ListingDetailsState;
  retry: () => void;
} {
  const [retryVersion, setRetryVersion] = useState(0);
  const [settledState, setSettledState] = useState<SettledListingDetailsState | null>(null);
  const requestKey = id ? `${id}:${retryVersion}` : null;

  useEffect(() => {
    if (!id || !requestKey) {
      return;
    }

    const controller = new AbortController();

    void getListing(id, controller.signal)
      .then(({ listing }) => {
        if (controller.signal.aborted) {
          return;
        }

        setSettledState({
          requestKey,
          state: {
            status: 'success',
            listing,
          },
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setSettledState({
          requestKey,
          state: isUnavailableListingError(error) ? NOT_FOUND_STATE : { status: 'error' },
        });
      });

    return () => {
      controller.abort();
    };
  }, [id, requestKey]);

  const retry = useCallback(() => {
    setRetryVersion((version) => version + 1);
  }, []);

  const state = !requestKey
    ? NOT_FOUND_STATE
    : settledState?.requestKey === requestKey
      ? settledState.state
      : LOADING_STATE;

  return {
    state,
    retry,
  };
}
