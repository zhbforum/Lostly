import { useEffect, useRef, useState } from 'react';
import type { ListingImage } from '@lostly/contracts/listings';
import { uploadListingImage } from '@/features/listings/api/listing-images-api';
import { imageErrorMessage, validateImageSelection, type SelectedImage } from './image-selection';

export function useImageQueue() {
  const [items, setItems] = useState<SelectedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(items);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  function update(next: SelectedImage[]) {
    current.current = next;
    setItems(next);
  }
  function add(files: File[], existingCount = 0) {
    if (request.current) return;
    const validationError = validateImageSelection(
      files,
      existingCount + current.current.filter((item) => item.status !== 'uploaded').length,
    );
    setError(validationError);
    if (validationError) return;
    update([
      ...current.current,
      ...files.map((file): SelectedImage => ({
        id: crypto.randomUUID(),
        file,
        status: 'selected',
      })),
    ]);
  }
  function remove(id: string) {
    if (request.current) return;
    update(current.current.filter((item) => item.id !== id));
    setError(null);
  }
  function discardUploaded() {
    if (request.current) return 0;
    const remaining = current.current.filter((item) => item.status !== 'uploaded');
    const completed = current.current.length - remaining.length;
    if (completed > 0) update(remaining);
    return completed;
  }
  function reset() {
    request.current?.abort();
    request.current = null;
    update([]);
    setError(null);
  }

  async function upload(listingId: string, onUploaded?: (image: ListingImage) => void) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    try {
      for (const item of current.current.filter((candidate) => candidate.status !== 'uploaded')) {
        if (controller.signal.aborted) break;
        const change = (patch: Partial<SelectedImage>) =>
          update(current.current.map((row) => (row.id === item.id ? { ...row, ...patch } : row)));
        change({ status: 'uploading', error: undefined });
        try {
          const { image } = await uploadListingImage(
            listingId,
            item.file,
            item.id,
            controller.signal,
          );
          if (controller.signal.aborted) break;
          change({ status: 'uploaded' });
          onUploaded?.(image);
        } catch (cause) {
          if (controller.signal.aborted) break;
          change({ status: 'failed', error: imageErrorMessage(cause) });
        }
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  return {
    items,
    error,
    add,
    remove,
    discardUploaded,
    reset,
    upload,
    busy: items.some((item) => item.status === 'uploading'),
  };
}
