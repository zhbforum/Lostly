import sharp from 'sharp';
import { LISTING_IMAGE_CONSTRAINTS } from '@lostly/contracts/listings';
import { ImageError } from './errors';
import { assertStaticPng } from './png';

export const IMAGE_PROCESSING_LIMITS = {
  maxInputPixels: 40_000_000,
  maxOutputDimension: 2048,
  maxConcurrent: 2,
} as const;

export async function prepareImage(file: Blob) {
  if (file.size === 0 || file.size > LISTING_IMAGE_CONSTRAINTS.maxSizeBytes) {
    throw new ImageError('invalid-image');
  }
  const source = Buffer.from(await file.arrayBuffer());
  assertStaticPng(source);
  const sourceHash = new Bun.CryptoHasher('sha256').update(source).digest('hex');
  try {
    const pipeline = sharp(source, {
      limitInputPixels: IMAGE_PROCESSING_LIMITS.maxInputPixels,
      failOn: 'warning',
      animated: true,
    });
    const metadata = await pipeline.metadata();
    if (
      !metadata.format ||
      !['jpeg', 'png', 'webp'].includes(metadata.format) ||
      (metadata.pages ?? 1) !== 1
    )
      throw new ImageError('invalid-image');
    // Re-encoding fully decodes the input and removes EXIF/XMP/IPTC. Rotate before stripping
    // EXIF orientation. The original is never stored; transparent input stays transparent.
    const { data, info } = await pipeline
      .rotate()
      .resize({
        width: IMAGE_PROCESSING_LIMITS.maxOutputDimension,
        height: IMAGE_PROCESSING_LIMITS.maxOutputDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .timeout({ seconds: 10 })
      .toBuffer({ resolveWithObject: true });
    if (data.byteLength > LISTING_IMAGE_CONSTRAINTS.maxSizeBytes)
      throw new ImageError('invalid-image');
    return {
      data: new Blob([new Uint8Array(data)], { type: 'image/webp' }),
      sourceHash,
      contentType: 'image/webp' as const,
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    if (error instanceof ImageError) throw error;
    throw new ImageError('invalid-image');
  }
}
