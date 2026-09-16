import { useEffect, useRef, useState } from 'react';
import type { SelectedImage } from '@/features/listings/model/image-selection';
import { PhotoIcon } from './PhotoIcon';
import styles from './ListingPhotos.module.css';

export function SelectedPhoto({
  item,
  number,
  first,
  onRemove,
}: {
  item: SelectedImage;
  number: number;
  first: boolean;
  onRemove: (id: string) => void;
}) {
  const image = useRef<HTMLImageElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const url = URL.createObjectURL(item.file);
    if (image.current) image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [item.file]);

  return (
    <li className={styles.tile}>
      <div className={styles.previewFrame}>
        {unavailable ? (
          <div className={`${styles.preview} ${styles.placeholder}`}>Preview unavailable</div>
        ) : (
          <img
            ref={image}
            className={styles.preview}
            alt={`Selected photo ${number}`}
            onError={() => setUnavailable(true)}
          />
        )}
        {first && <span className={styles.badge}>First photo</span>}
      </div>
      <div className={styles.tileBody}>
        <div className={styles.row}>
          <span className={styles.photoName}>Photo {number}</span>
          <button
            className={styles.iconButton}
            type="button"
            onClick={() => onRemove(item.id)}
            aria-label={`Remove selected photo ${number}`}
            title="Remove photo"
          >
            <PhotoIcon name="remove" />
          </button>
        </div>
        <p className={item.status === 'failed' ? styles.errorText : styles.hint}>
          {item.status === 'uploading'
            ? 'Uploading…'
            : item.status === 'failed'
              ? 'Not uploaded'
              : 'Ready to upload'}
        </p>
        {item.error && (
          <p className={styles.errorText} role="alert">
            {item.error}
          </p>
        )}
      </div>
    </li>
  );
}
