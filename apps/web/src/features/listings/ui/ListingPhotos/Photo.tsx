import { useState } from 'react';
import type { ListingImage } from '@lostly/contracts/listings';
import styles from './ListingPhotos.module.css';

export function Photo({
  image,
  alt,
  className,
  lazy = true,
  onError,
}: {
  image: ListingImage;
  alt: string;
  className: string;
  lazy?: boolean;
  onError: (image: ListingImage) => void;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === image.url)
    return (
      <div
        className={`${className} ${styles.placeholder}`}
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
      >
        Photo unavailable
      </div>
    );
  return (
    <img
      src={image.url}
      alt={alt}
      className={className}
      width={image.width}
      height={image.height}
      loading={lazy ? 'lazy' : 'eager'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => {
        setFailedUrl(image.url);
        onError(image);
      }}
    />
  );
}
