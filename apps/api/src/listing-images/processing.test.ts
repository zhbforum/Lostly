import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { animatedPngFixture, imageFixture, pngChunk } from '@tests/support/image-fixture';
import { prepareImage } from './processing';
import { ImageError } from './errors';
import { LISTING_IMAGE_CONSTRAINTS } from '@lostly/contracts/listings';

describe('photo normalization', () => {
  test('rejects APNG and animated WebP instead of silently keeping the first frame', async () => {
    await expect(prepareImage(await animatedPngFixture())).rejects.toMatchObject({
      reason: 'invalid-image',
    });
    const first = Buffer.from(await (await imageFixture('png', '#ff0000')).arrayBuffer());
    const second = Buffer.from(await (await imageFixture('png', '#00ff00')).arrayBuffer());
    const animated = await sharp([first, second], { join: { animated: true } })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2);
    await expect(prepareImage(new Blob([new Uint8Array(animated)]))).rejects.toMatchObject({
      reason: 'invalid-image',
    });
  });
  test('rejects declared dimensions above the pixel budget before decoding', async () => {
    const png = Buffer.from(await (await imageFixture()).arrayBuffer());
    const header = Buffer.from(png.subarray(16, 29));
    header.writeUInt32BE(10000, 0);
    header.writeUInt32BE(10000, 4);
    const tooLarge = Buffer.concat([
      png.subarray(0, 8),
      pngChunk('IHDR', header),
      png.subarray(33),
    ]);
    await expect(prepareImage(new Blob([new Uint8Array(tooLarge)]))).rejects.toMatchObject({
      reason: 'invalid-image',
    });
  });
  test.each(['jpeg', 'png', 'webp'] as const)(
    'decodes %s, preserves proportions and stores WebP',
    async (format) => {
      const result = await prepareImage(await imageFixture(format));
      expect(result.contentType).toBe('image/webp');
      expect([result.width, result.height]).toEqual([32, 24]);
      expect((await sharp(Buffer.from(await result.data.arrayBuffer())).metadata()).format).toBe(
        'webp',
      );
    },
  );
  test('uses the bytes instead of a forged MIME or filename', async () => {
    const real = await imageFixture();
    const result = await prepareImage(new File([real], '../../attack.svg', { type: 'text/html' }));
    expect(result.contentType).toBe('image/webp');
    await expect(
      prepareImage(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/png' })),
    ).rejects.toBeInstanceOf(ImageError);
  });
  test('removes EXIF and applies orientation before resizing', async () => {
    const input = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: '#4488cc' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const result = await prepareImage(new Blob([new Uint8Array(input)]));
    expect([result.width, result.height]).toEqual([1024, 2048]);
    const metadata = await sharp(Buffer.from(await result.data.arrayBuffer())).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });
  test('rejects empty, oversized and truncated images', async () => {
    for (const file of [
      new Blob(),
      new Blob([new Uint8Array(LISTING_IMAGE_CONSTRAINTS.maxSizeBytes + 1)]),
      new Blob([(await (await imageFixture('jpeg')).arrayBuffer()).slice(0, 24)]),
    ]) {
      await expect(prepareImage(file)).rejects.toBeInstanceOf(ImageError);
    }
  });
  test('accepts the inclusive 5 MiB boundary and strips trailing data', async () => {
    const file = await imageFixture('jpeg');
    const padded = new Blob([
      file,
      new Uint8Array(LISTING_IMAGE_CONSTRAINTS.maxSizeBytes - file.size),
    ]);
    const result = await prepareImage(padded);
    expect(result.data.size).toBeLessThan(1024);
  });
});
