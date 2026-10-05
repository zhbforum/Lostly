import sharp from 'sharp';
import { InvalidImageError } from './errors';
import { assertStaticPng } from './png';

export const IMAGE_PROCESSING_LIMITS = {
  maxInputPixels: 40_000_000,
  maxOutputDimension: 2048,
} as const;

export interface ImageSource {
  readonly bytes: Buffer;
  readonly sourceHash: string;
}

export interface PreparedImage {
  data: Blob;
  contentType: 'image/webp';
  width: number;
  height: number;
}

export async function readImageSource(
  file: Blob,
  { maxBytes }: { maxBytes: number },
): Promise<ImageSource> {
  if (file.size === 0 || file.size > maxBytes) {
    throw new InvalidImageError();
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  return { bytes, sourceHash: new Bun.CryptoHasher('sha256').update(bytes).digest('hex') };
}

export async function prepareImage(
  source: Buffer,
  { maxOutputBytes }: { maxOutputBytes: number },
): Promise<PreparedImage> {
  assertStaticPng(source);
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
      throw new InvalidImageError();
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
    if (data.byteLength > maxOutputBytes) throw new InvalidImageError();
    return {
      data: new Blob([new Uint8Array(data)], { type: 'image/webp' }),
      contentType: 'image/webp' as const,
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    if (error instanceof InvalidImageError) throw error;
    throw new InvalidImageError();
  }
}
