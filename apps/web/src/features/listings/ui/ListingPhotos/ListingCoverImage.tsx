import { useMemo } from 'react';
import type { ListingImage } from '@lostly/contracts/listings';
import { usePhotoUrls } from '@/features/listings/model/use-photo-urls';
import { Photo } from './Photo';
import { PhotoIcon } from './PhotoIcon';
import styles from './ListingPhotos.module.css';

export function ListingCoverImage({
  listingId,
  image,
}: {
  listingId: string;
  image: ListingImage | null;
}) {
  const initial = useMemo(() => (image ? [image] : []), [image]);
  const photos = usePhotoUrls(listingId, initial);
  const cover = photos.images[0];
  return cover ? (
    <Photo image={cover} alt="" className={styles.cover} onError={photos.onImageError} />
  ) : (
    <div className={`${styles.cover} ${styles.placeholder}`} aria-hidden="true">
      <span>
        <PhotoIcon name="image" />
        <br />
        No photo yet
      </span>
    </div>
  );
}
