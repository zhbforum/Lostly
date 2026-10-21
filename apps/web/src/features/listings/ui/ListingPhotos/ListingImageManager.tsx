import { useEffect, useRef, useState } from 'react';
import type { ListingImage } from '@lostly/contracts/listings';
import { deleteListingImage, orderListingImages } from '@/features/listings/api/listing-images-api';
import { imageErrorMessage } from '@/features/listings/model/image-selection';
import { useImageQueue } from '@/features/listings/model/use-image-queue';
import { ListingImagePicker } from './ListingImagePicker';
import { SavedPhotoCard } from './SavedPhotoCard';
import { DeletePhotoDialog } from './DeletePhotoDialog';
import { PhotoUploadStatus } from './PhotoUploadStatus';
import styles from './ListingPhotos.module.css';

export function ListingImageManager({
  listingId,
  images,
  onChanged,
  onReload,
  onImageError,
}: {
  listingId: string;
  images: ListingImage[];
  onChanged: (images: ListingImage[]) => void;
  onReload: () => Promise<void>;
  onImageError: (image: ListingImage) => void;
}) {
  const queue = useImageQueue();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ListingImage | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const busy = pending || queue.busy;
  const remaining = queue.items.filter((item) => item.status !== 'uploaded').length;

  async function change(action: (signal: AbortSignal) => Promise<ListingImage[]>, message: string) {
    if (request.current || queue.busy) return false;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const next = await action(controller.signal);
      if (controller.signal.aborted) return false;
      onChanged(next);
      setNotice(message);
      return true;
    } catch (cause) {
      if (!controller.signal.aborted) setError(imageErrorMessage(cause));
      return false;
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setPending(false);
      }
    }
  }

  function reorder(ids: string[], message = 'Photo order saved.'): Promise<boolean> {
    return change(
      async (signal) => (await orderListingImages(listingId, ids, signal)).images,
      message,
    );
  }

  async function makeCover(imageId: string) {
    const saved = await reorder(
      [imageId, ...images.filter((image) => image.id !== imageId).map((image) => image.id)],
      'Cover photo updated.',
    );
    if (saved) {
      // The new cover replaces its action button with a hint.
      requestAnimationFrame(() => heading.current?.focus());
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const deleted = await change(async (signal) => {
      await deleteListingImage(listingId, deleting.id, signal);
      return images
        .filter((image) => image.id !== deleting.id)
        .map((image, position) => ({ ...image, position }));
    }, 'Photo deleted.');
    if (deleted) {
      setDeleting(null);
      // The deleted card's trigger no longer exists; give keyboard users a stable destination.
      requestAnimationFrame(() => heading.current?.focus());
    }
  }

  return (
    <section className={styles.manager} aria-label="Manage photos">
      <header className={styles.managerHeader}>
        <h2 className={styles.heading} ref={heading} tabIndex={-1}>
          Your photos
        </h2>
        <p className={styles.body}>Choose a cover that makes your item easy to recognize.</p>
        <p className={styles.hint}>
          Reordering and deletion save immediately. Upload new photos below.
        </p>
      </header>
      {images.length > 0 && (
        <ul className={styles.grid} aria-label="Saved photos" aria-busy={busy}>
          {images.map((image, index) => (
            <SavedPhotoCard
              key={image.id}
              image={image}
              index={index}
              count={images.length}
              busy={busy}
              onImageError={onImageError}
              onMove={(offset) => {
                const ids = images.map((row) => row.id);
                [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
                void reorder(ids);
              }}
              onCover={() => void makeCover(image.id)}
              onDelete={() => {
                setError(null);
                setDeleting(image);
              }}
            />
          ))}
        </ul>
      )}
      <p role="status" className={styles.status} aria-atomic="true">
        {pending ? 'Saving photo changes…' : notice}
      </p>
      {error && !deleting && (
        <div className={styles.error} role="alert">
          <p>{error}</p>
          <button
            className={styles.button}
            type="button"
            disabled={busy}
            onClick={() =>
              void onReload()
                .then(() => setError(null))
                .catch(() => setError('Could not reload photos. Please try again.'))
            }
          >
            Reload photos
          </button>
        </div>
      )}
      <div className={styles.addSection}>
        <ListingImagePicker
          items={queue.items}
          error={queue.error}
          onAdd={(files) => queue.add(files, images.length)}
          onRemove={queue.remove}
          disabled={busy}
          existingCount={images.length}
          variant="manage"
        />
        <PhotoUploadStatus items={queue.items} busy={queue.busy} />
        {remaining > 0 && (
          <div className={styles.actions}>
            <button
              className={`${styles.button} ${styles.primaryAction}`}
              type="button"
              disabled={busy}
              onClick={async () => {
                setError(null);
                setNotice(null);
                const next = [...images];
                await queue.upload(listingId, (image) => {
                  if (!next.some((row) => row.id === image.id)) next.push(image);
                  onChanged([...next].sort((a, b) => a.position - b.position));
                });
                // Saved images now live in the collection, not in this batch's upload queue.
                const uploaded = queue.discardUploaded();
                if (uploaded > 0) {
                  setNotice(uploaded === 1 ? 'Photo uploaded.' : `${uploaded} photos uploaded.`);
                }
              }}
            >
              {queue.busy
                ? 'Uploading photos…'
                : queue.items.some((item) => item.status === 'failed')
                  ? 'Retry failed photos'
                  : 'Upload photos'}
            </button>
            {!busy && (
              <span className={styles.hint}>
                {remaining} {remaining === 1 ? 'photo' : 'photos'} ready to send
              </span>
            )}
          </div>
        )}
      </div>
      <DeletePhotoDialog
        open={deleting !== null}
        pending={pending}
        error={error}
        onClose={() => {
          if (!request.current) {
            setDeleting(null);
            setError(null);
          }
        }}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
