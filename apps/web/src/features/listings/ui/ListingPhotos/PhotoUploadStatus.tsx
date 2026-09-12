import type { SelectedImage } from '@/features/listings/model/image-selection';
import { PhotoIcon } from './PhotoIcon';
import styles from './ListingPhotos.module.css';

export function PhotoUploadStatus({ items, busy }: { items: SelectedImage[]; busy: boolean }) {
  if (!items.length) return null;
  const uploaded = items.filter((item) => item.status === 'uploaded').length;
  const failed = items.some((item) => item.status === 'failed');
  const complete = uploaded === items.length;
  return (
    <div className={styles.uploadStatus} data-complete={complete}>
      <div className={styles.row}>
        <span className={styles.photoName}>
          {busy
            ? 'Uploading your photos'
            : complete
              ? 'Your photos are ready'
              : failed
                ? 'Some photos need another try'
                : 'Ready to upload'}
        </span>
        {complete && <PhotoIcon name="check" />}
      </div>
      <p role="status" className={styles.body} aria-atomic="true">
        {uploaded} of {items.length} photos uploaded.
      </p>
      <progress
        className={styles.progress}
        value={uploaded}
        max={items.length}
        aria-label="Photos uploaded"
      />
      {busy && <p className={styles.hint}>Keep this page open until uploading finishes.</p>}
    </div>
  );
}
