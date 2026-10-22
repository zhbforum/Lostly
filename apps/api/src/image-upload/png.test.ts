import { expect, test } from 'bun:test';
import { imageFixture, pngChunk } from '@tests/support/image-fixture';
import { InvalidImageError } from './errors';
import { assertStaticPng } from './png';

test('rejects a PNG whose final chunk is truncated', async () => {
  const png = Buffer.from(await (await imageFixture()).arrayBuffer());

  expect(() => assertStaticPng(png.subarray(0, -1))).toThrow(InvalidImageError);
});

test('rejects a PNG that ends on a chunk boundary without IEND', async () => {
  const png = Buffer.from(await (await imageFixture()).arrayBuffer());
  expect(png.toString('ascii', png.length - 8, png.length - 4)).toBe('IEND');

  expect(() => assertStaticPng(png.subarray(0, -12))).toThrow(InvalidImageError);
});

test('rejects a chunk whose declared length exceeds the available PNG bytes', async () => {
  const png = Buffer.from(await (await imageFixture()).arrayBuffer());
  png.writeUInt32BE(0xffffffff, 8);

  expect(() => assertStaticPng(png)).toThrow(InvalidImageError);
});

test('does not mistake animation markers inside chunk data for an animation chunk', async () => {
  const png = Buffer.from(await (await imageFixture()).arrayBuffer());
  const headerEnd = 8 + 12 + png.readUInt32BE(8);
  const withText = Buffer.concat([
    png.subarray(0, headerEnd),
    pngChunk('tEXt', Buffer.from('Comment\0contains acTL text, not an animation chunk')),
    png.subarray(headerEnd),
  ]);

  expect(() => assertStaticPng(withText)).not.toThrow();
});
