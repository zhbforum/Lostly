import { useEffect, useId, useRef } from 'react';
import { LISTING_IMAGE_CONSTRAINTS } from '@lostly/contracts/listings';
import type { SelectedImage } from '@/features/listings/model/image-selection';
import { PhotoIcon } from './PhotoIcon';
import { SelectedPhoto } from './SelectedPhoto';
import styles from './ListingPhotos.module.css';

export function ListingImagePicker({
  items,
  error,
  onAdd,
  onRemove,
  disabled = false,
  existingCount = 0,
  variant = 'create',
}: {
  items: SelectedImage[];
  error: string | null;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
  existingCount?: number;
  variant?: 'create' | 'manage';
}) {
  const hintId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(false);
  const pending = items.filter((item) => item.status !== 'uploaded');
  const count = existingCount + pending.length;
  const full = count >= LISTING_IMAGE_CONSTRAINTS.maxCount;
  useEffect(() => {
    if (restoreFocus.current) {
      restoreFocus.current = false;
      input.current?.focus();
    }
  }, [count]);
  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend className={styles.legend}>
        {variant === 'create' ? 'Photos' : 'Add photos'}
        {variant === 'create' && <span className={styles.optional}>Optional</span>}
      </legend>
      <div className={styles.pickerIntro}>
        <p className={styles.body}>
          {variant === 'create'
            ? 'A clear photo helps people recognize the item.'
            : 'Choose photos, then upload them to this report.'}
        </p>
        <span className={styles.count} role="status" aria-label={`${count} of 5 photo slots used`}>
          {count} / 5
        </span>
      </div>
      <p id={hintId} className={styles.hint}>
        JPEG, PNG or WebP · up to 5 MiB each. Still images up to 40 megapixels.
      </p>
      <label className={styles.uploadArea} data-disabled={disabled || full}>
        <span className={styles.uploadIcon}>
          <PhotoIcon name={full ? 'check' : 'image'} />
        </span>
        <span className={styles.uploadCopy}>
          <span className={styles.photoName}>
            {full ? 'All 5 photo slots are used' : 'Choose photos from your device'}
          </span>
          <span className={styles.hint}>
            {full ? 'Remove a photo to add another.' : 'You can select more than one.'}
          </span>
        </span>
        {!full && (
          <span className={styles.chooseAction}>
            <PhotoIcon name="add" /> Add photos
          </span>
        )}
        <input
          ref={input}
          type="file"
          className={styles.input}
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={disabled || full}
          aria-label="Add photos"
          aria-describedby={`${hintId}${error ? ` ${errorId}` : ''}`}
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) onAdd(files);
            event.target.value = '';
          }}
        />
      </label>
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
      {pending.length > 0 && (
        <ul className={styles.grid} aria-label="Selected photos">
          {pending.map((item, index) => (
            <SelectedPhoto
              key={item.id}
              item={item}
              number={index + 1}
              first={existingCount === 0 && index === 0}
              onRemove={(id) => {
                restoreFocus.current = true;
                onRemove(id);
              }}
            />
          ))}
        </ul>
      )}
      {variant === 'create' && (
        <p className={styles.hint}>
          The first uploaded photo becomes your cover. You can change it later. Keep private proof
          of ownership out of photos.
        </p>
      )}
    </fieldset>
  );
}
