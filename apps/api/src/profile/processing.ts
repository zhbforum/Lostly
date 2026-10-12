import sharp from 'sharp';
import { PROFILE_CONSTRAINTS as limits } from '@lostly/contracts/profile';
import { assertStaticPng } from '@/image-upload/png';
import { ProfileError } from './errors';

export async function prepareAvatar(file: Blob) {
  if (!file.size || file.size > limits.avatarMaxBytes) throw new ProfileError('invalid-image');
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    assertStaticPng(bytes);
    const options = { limitInputPixels: limits.avatarMaxPixels, failOn: 'warning' as const };
    const metadata = await sharp(bytes, { ...options, animated: true }).metadata();
    const frames = metadata.pages ?? 1;
    const frameHeight = metadata.pageHeight ?? metadata.height ?? 0;
    if (
      !['jpeg', 'png', 'webp', 'gif'].includes(metadata.format ?? '') ||
      !metadata.width ||
      !frameHeight ||
      frames > limits.avatarMaxFrames ||
      metadata.width * frameHeight * frames > limits.avatarMaxPixels
    )
      throw new ProfileError('invalid-image');
    const animated = frames > 1;
    const resize = {
      width: limits.avatarDimension,
      height: limits.avatarDimension,
      fit: 'cover' as const,
      position: 'centre',
    };
    const still = await sharp(bytes, { ...options, pages: 1 })
      .rotate()
      .resize(resize)
      .webp({ quality: 85 })
      .timeout({ seconds: 10 })
      .toBuffer();
    const image = animated
      ? await sharp(bytes, { ...options, animated: true })
          .resize(resize)
          .webp({ quality: 80, effort: 3 })
          .timeout({ seconds: 10 })
          .toBuffer()
      : still;
    if (image.byteLength > limits.avatarMaxBytes) throw new ProfileError('invalid-image');
    return {
      animated,
      image: new Blob([new Uint8Array(image)], { type: 'image/webp' }),
      still: new Blob([new Uint8Array(still)], { type: 'image/webp' }),
    };
  } catch (error) {
    if (error instanceof ProfileError) throw error;
    throw new ProfileError('invalid-image');
  }
}
