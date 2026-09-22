import type { ListingImage } from '@lostly/contracts/listings';
import { usePhotoUrls } from '@/features/listings/model/use-photo-urls';
import { ListingGallery } from './ListingGallery';
import { ListingImageManager } from './ListingImageManager';
import { PhotoIcon } from './PhotoIcon';
import styles from './ListingPhotos.module.css';

export function ListingPhotos({
  listingId,
  images,
  canManage,
  mode = 'detail',
}: {
  listingId: string;
  images: ListingImage[];
  canManage: boolean;
  mode?: 'detail' | 'edit';
}) {
  const photos = usePhotoUrls(listingId, images);
  if (!canManage && !photos.images.length) return null;
  const manager = (
    <ListingImageManager
      listingId={listingId}
      images={photos.images}
      onChanged={photos.setImages}
      onReload={photos.refresh}
      onImageError={photos.onImageError}
    />
  );
  return (
    <div className={`${styles.panel} ${mode === 'edit' ? styles.editorPanel : ''}`}>
      {mode === 'edit' && canManage ? (
        manager
      ) : (
        <>
          <ListingGallery images={photos.images} onImageError={photos.onImageError} />
          {canManage && (
            <details className={styles.managementDisclosure}>
              <summary>
                <span>
                  <span className={styles.photoName}>Manage photos</span>
                  <span className={styles.hint}>Add, reorder or remove your photos</span>
                </span>
                <PhotoIcon name="right" />
              </summary>
              {manager}
            </details>
          )}
        </>
      )}
    </div>
  );
}
