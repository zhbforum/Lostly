import { CONVERSATION_IMAGE_CONSTRAINTS } from './types';

// Browser metadata is a UX hint; the server still validates actual image bytes.
export function imageSelectionError(images: readonly File[], existingCount = 0): string | null {
  const { maxCount, maxSizeBytes, allowedContentTypes } = CONVERSATION_IMAGE_CONSTRAINTS;
  if (existingCount + images.length > maxCount) return `You can attach up to ${maxCount} images.`;
  for (const file of images) {
    if (file.size === 0) return 'This image is empty.';
    if (file.size > maxSizeBytes)
      return `Each image must be ${maxSizeBytes / (1024 * 1024)} MiB or smaller.`;
    if (file.type && !allowedContentTypes.some((type) => type === file.type))
      return 'Choose JPEG, PNG, or WebP images.';
  }
  return null;
}

export function imageCountLabel(count: number) {
  return count === 1 ? 'Photo' : `${count} photos`;
}
