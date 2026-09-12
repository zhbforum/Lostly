import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListingImage } from '@lostly/contracts/listings';
import { getListing } from '@/features/listings/api/listings-api';

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
  const failedRefreshes = useRef(new Set<string>());
  useEffect(() => {
    request.current?.controller.abort();
    request.current = null;
    failedRefreshes.current.clear();
  }, [listingId, initial]);
  useEffect(() => () => request.current?.controller.abort(), []);

  const refresh = useCallback(() => {
    if (request.current) return request.current.promise;
    const controller = new AbortController();
    const promise = (async () => {
      const result = await getListing(listingId, controller.signal);
      if (!controller.signal.aborted)
        setCollection((current) => ({ ...current, images: result.images }));
    })()
      .catch((error: unknown) => {
        // A superseded read is cancellation, not a failed reload.
        if (!controller.signal.aborted) throw error;
      })
      .finally(() => {
        if (request.current?.controller === controller) request.current = null;
      });
    request.current = { controller, promise };
    return promise;
  }, [listingId]);

  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      const expired = images.filter(
        (image) => Date.parse(image.urlExpiresAt) <= Date.now() + 30_000,
      );
      if (!expired.some((image) => !failedRefreshes.current.has(image.url))) return;
      expired.forEach((image) => failedRefreshes.current.add(image.url));
      void refresh().catch(() => {});
    };
    check();
    const timer = window.setInterval(check, 30_000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [images, refresh]);

  const onImageError = useCallback(
    (image: ListingImage) => {
      // One recovery per image per mounted collection, even if R2 keeps returning broken URLs.
      const key = `error:${image.id}`;
      if (failedRefreshes.current.has(key)) return;
      failedRefreshes.current.add(key);
      void refresh().catch(() => {});
    },
    [refresh],
  );

  const setImages = useCallback((images: ListingImage[]) => {
    // An older refresh must not overwrite the response to a completed mutation.
    request.current?.controller.abort();
    request.current = null;
    setCollection((current) => ({ ...current, images }));
  }, []);
  return { images, setImages, refresh, onImageError };
}
