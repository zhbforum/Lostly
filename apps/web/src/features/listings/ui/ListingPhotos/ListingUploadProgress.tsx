import type { useImageQueue } from '@/features/listings/model/use-image-queue';
import { ListingImagePicker } from './ListingImagePicker';
import { PhotoUploadStatus } from './PhotoUploadStatus';
import styles from './ListingPhotos.module.css';

export function ListingUploadProgress({
  listingId,
  queue,
}: {
  listingId: string;
  queue: ReturnType<typeof useImageQueue>;
}) {
  if (!queue.items.length) return null;
  const uploaded = queue.items.filter((item) => item.status === 'uploaded').length;
  const remaining = uploaded < queue.items.length;
  const failed = queue.items.some((item) => item.status === 'failed');
  return (
    <section className={styles.uploadProgress} aria-label="Photo uploads">
      <PhotoUploadStatus items={queue.items} busy={queue.busy} />
      {remaining && (
        <>
          {!queue.busy && (
            <p className={styles.body}>
              Your report is saved. Retry the remaining photos here, or add them later from your
              report.
            </p>
          )}
          <ListingImagePicker
            items={queue.items}
            error={queue.error}
            onAdd={(files) => queue.add(files, uploaded)}
            onRemove={queue.remove}
            existingCount={uploaded}
            disabled={queue.busy}
            variant="manage"
          />
          {!queue.busy && (
            <button
              className={`${styles.button} ${styles.primaryAction}`}
              type="button"
              onClick={() => void queue.upload(listingId)}
            >
              {failed ? 'Retry failed photos' : 'Upload remaining photos'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
