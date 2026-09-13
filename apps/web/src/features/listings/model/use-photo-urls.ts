import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListingImage } from '@lostly/contracts/listings';
import { getListing } from '@/features/listings/api/listings-api';
import { ApiError } from '@/shared/api/client';

export const PHOTO_REFRESH_INTERVAL_MS = 30_000;
const MAX_RETRY_DELAY_MS = 120_000;

function initialRecovery() {
  return { pending: false, failures: 0, nextAttemptAt: 0, blocked: false };
}

function isRetryable(error: unknown) {
  return (
    !(error instanceof ApiError) ||
    error.status < 400 ||
    error.status >= 500 ||
    error.status === 408 ||
    error.status === 429
  );
}

interface PhotoRefreshRequest {
  controller: AbortController;
  promise: Promise<void>;
}

// Refresh only the photo collection: refreshing URLs must not remount an unsaved text editor.
export function usePhotoUrls(listingId: string, initial: ListingImage[]) {
  const [collection, setCollection] = useState({ source: initial, images: initial });
  if (collection.source !== initial) setCollection({ source: initial, images: initial });
  const images = collection.source === initial ? collection.images : initial;
  const request = useRef<PhotoRefreshRequest | null>(null);
  // Broken image bytes get one URL replacement; failed API reads may retry with backoff.
  const imageRecoveryAttempts = useRef(new Set<string>());
  const recovery = useRef(initialRecovery());
  useEffect(() => {
    request.current?.controller.abort();
    request.current = null;
    imageRecoveryAttempts.current.clear();
    recovery.current = initialRecovery();
  }, [listingId, initial]);
  useEffect(() => () => request.current?.controller.abort(), []);

  const refresh = useCallback(() => {
    if (request.current) return request.current.promise;
    const controller = new AbortController();
    const promise = (async () => {
      const result = await getListing(listingId, controller.signal);
      if (!controller.signal.aborted) {
        recovery.current = {
          ...initialRecovery(),
          nextAttemptAt: Date.now() + PHOTO_REFRESH_INTERVAL_MS,
        };
        setCollection((current) => ({ ...current, images: result.images }));
      }
    })()
      .catch((error: unknown) => {
        // A superseded read is cancellation, not a failed reload.
        if (!controller.signal.aborted) {
          const failures = Math.min(recovery.current.failures + 1, 3);
          recovery.current = {
            pending: true,
            failures,
            nextAttemptAt:
              Date.now() +
              Math.min(PHOTO_REFRESH_INTERVAL_MS * 2 ** (failures - 1), MAX_RETRY_DELAY_MS),
            blocked: !isRetryable(error),
          };
          throw error;
        }
      })
      .finally(() => {
        if (request.current?.controller === controller) request.current = null;
      });
    request.current = { controller, promise };
    return promise;
  }, [listingId]);

  useEffect(() => {
    const check = () => {
      if (
        document.visibilityState !== 'visible' ||
        !navigator.onLine ||
        request.current ||
        recovery.current.blocked ||
        Date.now() < recovery.current.nextAttemptAt
      )
        return;
      if (
        !recovery.current.pending &&
        !images.some(
          (image) => Date.parse(image.urlExpiresAt) <= Date.now() + PHOTO_REFRESH_INTERVAL_MS,
        )
      )
        return;
      void refresh().catch(() => {});
    };
    check();
    const timer = window.setInterval(check, PHOTO_REFRESH_INTERVAL_MS);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [images, refresh]);

  const onImageError = useCallback(
    (image: ListingImage) => {
      // One recovery per image per mounted collection, even if R2 keeps returning broken URLs.
      if (imageRecoveryAttempts.current.has(image.id)) return;
      imageRecoveryAttempts.current.add(image.id);
      recovery.current.pending = true;
      if (
        navigator.onLine &&
        document.visibilityState === 'visible' &&
        !recovery.current.blocked &&
        Date.now() >= recovery.current.nextAttemptAt
      ) {
        void refresh().catch(() => {});
      }
    },
    [refresh],
  );

  const setImages = useCallback((images: ListingImage[]) => {
    // An older refresh must not overwrite the response to a completed mutation.
    request.current?.controller.abort();
    request.current = null;
    recovery.current = initialRecovery();
    setCollection((current) => ({ ...current, images }));
  }, []);
  return { images, setImages, refresh, onImageError };
}
