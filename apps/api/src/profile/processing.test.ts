import { expect, test } from 'bun:test';
import sharp from 'sharp';
import { PROFILE_CONSTRAINTS } from '@lostly/contracts/profile';
import { imageFixture, animatedPngFixture, pngChunk } from '@tests/support/image-fixture';
import { prepareAvatar } from './processing';
import { parseAvatarUpload } from './multipart';

test.each(['jpeg', 'png', 'webp'] as const)(
  'normalizes %s avatars, strips metadata and crops to a square',
  async (format) => {
    const original = await imageFixture(format);
    const prepared = await prepareAvatar(new File([original], 'forged.svg', { type: 'text/html' }));
    const metadata = await sharp(Buffer.from(await prepared.image.arrayBuffer())).metadata();
    expect([metadata.format, metadata.width, metadata.height]).toEqual(['webp', 256, 256]);
    expect(metadata.exif).toBeUndefined();
    expect(prepared.animated).toBe(false);
    expect(await prepared.image.bytes()).toEqual(await prepared.still.bytes());
  },
);

test('preserves GIF frames, delays and looping while generating a static alternative', async () => {
  const first = Buffer.from(await (await imageFixture('png', '#ff0000')).arrayBuffer());
  const second = Buffer.from(await (await imageFixture('png', '#00ff00')).arrayBuffer());
  const gif = await sharp([first, second], { join: { animated: true } })
    .gif({ loop: 0, delay: [120, 240] })
    .toBuffer();
  const prepared = await prepareAvatar(new Blob([new Uint8Array(gif)]));
  const animated = await sharp(Buffer.from(await prepared.image.arrayBuffer()), {
    animated: true,
  }).metadata();
  const still = await sharp(Buffer.from(await prepared.still.arrayBuffer()), {
    animated: true,
  }).metadata();
  expect(prepared.animated).toBe(true);
  expect(animated.pages).toBe(2);
  expect(animated.pageHeight).toBe(256);
  expect(animated.width).toBe(256);
  expect(animated.loop).toBe(0);
  expect(animated.delay).toEqual([120, 240]);
  expect(still.pages ?? 1).toBe(1);
});

test('rejects unsafe formats, broken files, APNG, oversize files and excessive pixel/frame budgets', async () => {
  for (const file of [
    new Blob(),
    new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>']),
    new Blob(['not an image']),
    await animatedPngFixture(),
    new Blob([new Uint8Array(PROFILE_CONSTRAINTS.avatarMaxBytes + 1)]),
  ]) {
    await expect(prepareAvatar(file)).rejects.toMatchObject({ reason: 'invalid-image' });
  }
  const png = Buffer.from(await (await imageFixture()).arrayBuffer());
  const header = Buffer.from(png.subarray(16, 29));
  header.writeUInt32BE(10000, 0);
  header.writeUInt32BE(10000, 4);
  await expect(
    prepareAvatar(
      new Blob([
        new Uint8Array(
          Buffer.concat([png.subarray(0, 8), pngChunk('IHDR', header), png.subarray(33)]),
        ),
      ]),
    ),
  ).rejects.toMatchObject({ reason: 'invalid-image' });
  const frames = Array.from({ length: 101 }, (_, index) =>
    sharp({
      create: { width: 2, height: 2, channels: 3, background: index % 2 ? '#ff0000' : '#00ff00' },
    })
      .png()
      .toBuffer(),
  );
  const gif = await sharp(await Promise.all(frames), { join: { animated: true } })
    .gif({ delay: 100 })
    .toBuffer();
  await expect(prepareAvatar(new Blob([new Uint8Array(gif)]))).rejects.toMatchObject({
    reason: 'invalid-image',
  });
});

test('avatar multipart requires exactly one file and a positive version', async () => {
  const form = new FormData();
  form.set('file', await imageFixture());
  form.set('expectedVersion', '2');
  const request = () =>
    new Request('http://localhost/me/profile/avatar', { method: 'POST', body: form });
  expect((await parseAvatarUpload(request())).expectedVersion).toBe(2);
  form.append('file', await imageFixture());
  await expect(parseAvatarUpload(request())).rejects.toMatchObject({ reason: 'invalid-multipart' });
  form.delete('file');
  form.set('file', await imageFixture());
  form.set('expectedVersion', '-1');
  await expect(parseAvatarUpload(request())).rejects.toMatchObject({ reason: 'invalid-multipart' });
});
