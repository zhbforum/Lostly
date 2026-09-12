import { useState } from 'react';
import type { ListingImage } from '@lostly/contracts/listings';
import { Photo } from './Photo';
import { PhotoIcon } from './PhotoIcon';
import styles from './ListingPhotos.module.css';

export function ListingGallery({
  images,
  onImageError,
}: {
  images: ListingImage[];
  onImageError: (image: ListingImage) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = images.find((image) => image.id === selectedId) ?? images[0];
  const index = selected ? images.indexOf(selected) : 0;
  return (
    <section className={styles.gallery} aria-label="Report photos">
      <header className={styles.row}>
        <h2 className={styles.heading}>Photos</h2>
        {selected && (
          <span className={styles.count} aria-live="polite" aria-atomic="true">
            {index + 1} of {images.length}
          </span>
        )}
      </header>
      {selected ? (
        <>
          <Photo
            image={selected}
            alt={`Report photo ${index + 1}`}
            className={styles.mainImage}
            lazy={false}
            onError={onImageError}
          />
          {images.length > 1 && (
            <div className={styles.galleryNavigation}>
              <button
                className={styles.iconButton}
                type="button"
                disabled={index === 0}
                aria-label="Previous photo"
                onClick={() => setSelectedId(images[index - 1].id)}
              >
                <PhotoIcon name="left" />
              </button>
              <div className={styles.thumbs} aria-label="Choose a photo">
                {images.map((image, number) => (
                  <button
                    key={image.id}
                    type="button"
                    className={styles.thumbButton}
                    aria-label={`Show photo ${number + 1}`}
                    aria-pressed={image.id === selected.id}
                    onClick={() => setSelectedId(image.id)}
                  >
                    <Photo
                      image={image}
                      alt=""
                      className={styles.thumbnail}
                      onError={onImageError}
                    />
                  </button>
                ))}
              </div>
              <button
                className={styles.iconButton}
                type="button"
                disabled={index === images.length - 1}
                aria-label="Next photo"
                onClick={() => setSelectedId(images[index + 1].id)}
              >
                <PhotoIcon name="right" />
              </button>
            </div>
          )}
        </>
      ) : (
        <div className={styles.emptyGallery}>
          <PhotoIcon name="image" />
          <p className={styles.body}>No photos added yet.</p>
        </div>
      )}
    </section>
  );
}
