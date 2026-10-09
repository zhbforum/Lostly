import { describe, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { animatedPngFixture, imageFixture, pngChunk } from '@tests/support/image-fixture';
import { prepareImage as prepareSourceImage, readImageSource } from './processing';
import { InvalidImageError } from './errors';

const MAX_BYTES = 5 * 1024 * 1024;
async function prepareImage(file: Blob) {
  const source = await readImageSource(file, { maxBytes: MAX_BYTES });
  return prepareSourceImage(source.bytes, { maxOutputBytes: MAX_BYTES });
}

describe('photo normalization', () => {
  test('reads source bytes once and normalizes the exact hashed buffer without mutating it', async () => {
    const file = await imageFixture('jpeg');
    const read = spyOn(file, 'arrayBuffer');
    try {
      const source = await readImageSource(file, { maxBytes: MAX_BYTES });
      const original = Buffer.from(source.bytes);
      const hash = createHash('sha256').update(original).digest('hex');
      expect(source.sourceHash).toBe(hash);
      const prepared = await prepareSourceImage(source.bytes, { maxOutputBytes: MAX_BYTES });
      expect(read).toHaveBeenCalledTimes(1);
      expect(source.bytes.equals(original)).toBe(true);
      expect(source.sourceHash).toBe(hash);
      expect(Object.keys(prepared).sort()).toEqual(['contentType', 'data', 'height', 'width']);
    } finally {
      read.mockRestore();
    }
  });
  test('hashes metadata differences even when normalized pixels and output bytes match', async () => {
    const original = Buffer.from(await (await imageFixture()).arrayBuffer());
    const withMetadata = Buffer.concat([
      original.subarray(0, 33),
      pngChunk('tEXt', Buffer.from('Author\0Private author')),
      original.subarray(33),
    ]);
    const first = await readImageSource(new Blob([new Uint8Array(original)]), {
      maxBytes: MAX_BYTES,
    });
    const second = await readImageSource(new Blob([new Uint8Array(withMetadata)]), {
      maxBytes: MAX_BYTES,
    });
    expect(first.sourceHash).not.toBe(second.sourceHash);
    expect(second.sourceHash).toBe(createHash('sha256').update(withMetadata).digest('hex'));
    const normalizedFirst = await prepareSourceImage(first.bytes, { maxOutputBytes: MAX_BYTES });
    const normalizedSecond = await prepareSourceImage(second.bytes, { maxOutputBytes: MAX_BYTES });
    expect(await normalizedFirst.data.bytes()).toEqual(await normalizedSecond.data.bytes());
    expect(first.sourceHash).not.toBe(second.sourceHash);
  });
  test('hashing does not decode: malformed bytes can be identified before expensive validation', async () => {
    const source = await readImageSource(new Blob(['not an image']), { maxBytes: 100 });
    expect(source.sourceHash).toBe(createHash('sha256').update('not an image').digest('hex'));
    await expect(
      prepareSourceImage(source.bytes, { maxOutputBytes: MAX_BYTES }),
    ).rejects.toBeInstanceOf(InvalidImageError);
  });
  test('different EXIF bytes produce distinct source hashes even though normalization removes EXIF', async () => {
    const original = Buffer.from(await (await imageFixture('jpeg')).arrayBuffer());
    const sources = [];
    const normalized = [];
    for (const artist of ['Private author A', 'Private author B']) {
      const bytes = await sharp(original)
        .withExif({ IFD0: { Artist: artist } })
        .jpeg()
        .toBuffer();
      expect((await sharp(bytes).metadata()).exif).toBeDefined();
      const source = await readImageSource(new Blob([new Uint8Array(bytes)]), {
        maxBytes: MAX_BYTES,
      });
      sources.push(source);
      normalized.push(await prepareSourceImage(source.bytes, { maxOutputBytes: MAX_BYTES }));
    }
    expect(sources[0]!.sourceHash).not.toBe(sources[1]!.sourceHash);
    expect(await normalized[0]!.data.bytes()).toEqual(await normalized[1]!.data.bytes());
    expect(
      (await sharp(Buffer.from(await normalized[0]!.data.arrayBuffer())).metadata()).exif,
    ).toBeUndefined();
  });
  test('accepts caller-specific input and output bounds without reading rejected sources', async () => {
    const file = await imageFixture();
    const read = spyOn(file, 'arrayBuffer');
    try {
      await expect(readImageSource(file, { maxBytes: file.size - 1 })).rejects.toBeInstanceOf(
        InvalidImageError,
      );
      expect(read).not.toHaveBeenCalled();
      const source = await readImageSource(file, { maxBytes: file.size });
      await expect(prepareSourceImage(source.bytes, { maxOutputBytes: 1 })).rejects.toBeInstanceOf(
        InvalidImageError,
      );
    } finally {
      read.mockRestore();
    }
  });
  test('preserves transparency during WebP normalization', async () => {
    const input = await sharp({
      create: { width: 4, height: 3, channels: 4, background: { r: 40, g: 80, b: 120, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const result = await prepareSourceImage(input, { maxOutputBytes: MAX_BYTES });
    const normalized = sharp(Buffer.from(await result.data.arrayBuffer()));
    expect((await normalized.metadata()).hasAlpha).toBe(true);
    expect((await normalized.raw().toBuffer())[3]).toBe(0);
  });
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
    ).rejects.toBeInstanceOf(InvalidImageError);
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
      new Blob([new Uint8Array(MAX_BYTES + 1)]),
      new Blob([(await (await imageFixture('jpeg')).arrayBuffer()).slice(0, 24)]),
    ]) {
      await expect(prepareImage(file)).rejects.toBeInstanceOf(InvalidImageError);
    }
  });
  test('accepts the inclusive 5 MiB boundary and strips trailing data', async () => {
    const file = await imageFixture('jpeg');
    const padded = new Blob([file, new Uint8Array(MAX_BYTES - file.size)]);
    const result = await prepareImage(padded);
    expect(result.data.size).toBeLessThan(1024);
  });
});
