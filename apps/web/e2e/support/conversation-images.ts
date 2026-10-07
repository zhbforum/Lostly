import { deflateSync } from 'node:zlib';
import { expect, type Locator, type Page, type Request } from '@playwright/test';
import { pngChunk } from '@api-tests/support/image-fixture';

// Real decodable pixels, including extreme aspect ratios; no production fixture imports.
export function pngImage(width = 32, height = 24, color = 90) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2; // RGB
  const pixels = Buffer.alloc((width * 3 + 1) * height, color);
  for (let row = 0; row < height; row++) pixels[row * (width * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function chooserImages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `attachment-${index + 1}.png`,
    mimeType: 'image/png',
    buffer: pngImage(32, 24, 50 + index * 40),
  }));
}

export async function chooseImages(page: Page, count: number) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await (await chooser).setFiles(chooserImages(count));
}

export async function expectDecoded(images: Locator, count: number) {
  await expect(images).toHaveCount(count);
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(0);
  }
}

export function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

export async function multipartPayload(request: Request) {
  const contentType = request.headers()['content-type'];
  expect(contentType).toMatch(/^multipart\/form-data;\s*boundary=/);
  const key = request.headers()['idempotency-key'];
  expect(key).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i);
  const bytes = request.postDataBuffer();
  expect(bytes).not.toBeNull();
  const form = await new Response(new Uint8Array(bytes!), {
    headers: { 'Content-Type': contentType! },
  }).formData();
  expect([...form.keys()].every((name) => name === 'body' || name === 'images')).toBe(true);
  expect(form.getAll('body').length).toBeLessThanOrEqual(1);
  const images = await Promise.all(
    form.getAll('images').map(async (file) => {
      expect(typeof file).not.toBe('string');
      return Buffer.from(await (file as File).arrayBuffer()).toString('base64');
    }),
  );
  return { key, body: form.get('body'), images };
}
