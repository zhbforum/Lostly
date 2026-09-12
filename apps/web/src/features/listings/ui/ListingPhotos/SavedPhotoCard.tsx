import type { ListingImage } from '@lostly/contracts/listings';
import { Photo } from './Photo';
import { PhotoIcon } from './PhotoIcon';
import styles from './ListingPhotos.module.css';

export function SavedPhotoCard({
  image,
  index,
  count,
  busy,
  onMove,
  onCover,
  onDelete,
  onImageError,
}: {
  image: ListingImage;
  index: number;
  count: number;
  busy: boolean;
  onMove: (offset: number) => void;
  onCover: () => void;
  onDelete: () => void;
  onImageError: (image: ListingImage) => void;
}) {
  const number = index + 1;
  return (
    <li className={styles.tile}>
      <div className={styles.previewFrame}>
        <Photo
          image={image}
          alt={`Photo ${number}${index === 0 ? ', cover' : ''}`}
          className={styles.preview}
          onError={onImageError}
        />
        {index === 0 && (
          <span className={`${styles.badge} ${styles.coverBadge}`}>
            <PhotoIcon name="check" /> Cover
          </span>
        )}
      </div>
      <div className={styles.tileBody}>
        <div className={styles.row}>
          <span className={styles.photoName}>Photo {number}</span>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.deleteButton}`}
            disabled={busy}
            aria-label={`Delete photo ${number}`}
            title="Delete photo"
            onClick={onDelete}
          >
            <PhotoIcon name="trash" />
          </button>
        </div>
        {index === 0 ? (
          <p className={styles.hint}>Shown in search results</p>
        ) : (
          <button
            className={styles.coverAction}
            type="button"
            disabled={busy}
            aria-label={`Make photo ${number} cover`}
            onClick={onCover}
          >
            Make cover
          </button>
        )}
        <div className={styles.reorderActions} role="group" aria-label={`Reorder photo ${number}`}>
          <button
            type="button"
            className={styles.iconButton}
            disabled={busy || index === 0}
            aria-label={`Move photo ${number} left`}
            title="Move earlier"
            onClick={() => onMove(-1)}
          >
            <PhotoIcon name="left" />
          </button>
          <span className={styles.hint}>
            {number} / {count}
          </span>
          <button
            type="button"
            className={styles.iconButton}
            disabled={busy || index === count - 1}
            aria-label={`Move photo ${number} right`}
            title="Move later"
            onClick={() => onMove(1)}
          >
            <PhotoIcon name="right" />
          </button>
        </div>
      </div>
    </li>
  );
}
