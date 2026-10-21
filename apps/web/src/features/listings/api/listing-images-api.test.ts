import { afterEach, expect, it, vi } from 'vitest';
import { photo } from '@/test/fixtures/listing-images';
import { deleteListingImage, orderListingImages, uploadListingImage } from './listing-images-api';

afterEach(() => vi.unstubAllGlobals());

it('uploads the original file with an idempotency key and browser-owned multipart boundary', async () => {
  const response = { image: photo() };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
  vi.stubGlobal('fetch', fetcher);
  const file = new File(['image'], 'photo.png', { type: 'image/png' });
  const { signal } = new AbortController();

  await expect(uploadListingImage('report/1', file, 'operation-1', signal)).resolves.toEqual(
    response,
  );

  const [url, options] = fetcher.mock.calls[0]!;

  expect(new URL(String(url)).pathname).toBe('/listings/report%2F1/images');
  expect(options).toMatchObject({ method: 'POST', signal, credentials: 'include' });

  const body = options!.body as FormData;

  expect([...body.keys()]).toEqual(['file']);
  expect(body.get('file')).toBe(file);

  const headers = new Headers(options!.headers);

  expect(headers.get('Idempotency-Key')).toBe('operation-1');
  expect(headers.get('X-CSRF-Protection')).toBe('1');
  expect(headers.has('Content-Type')).toBe(false);
});

it('deletes encoded image IDs and accepts an empty 204 response', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  const { signal } = new AbortController();

  await expect(deleteListingImage('report/1', 'image/2', signal)).resolves.toBeUndefined();
  expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe(
    '/listings/report%2F1/images/image%2F2',
  );
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'DELETE', signal });
});

it('sends the complete image order without sorting it on the client', async () => {
  const response = { images: [photo(1), photo(0)] };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
  vi.stubGlobal('fetch', fetcher);
  const ids = response.images.map(({ id }) => id);
  const { signal } = new AbortController();

  await expect(orderListingImages('report/1', ids, signal)).resolves.toEqual(response);
  expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe(
    '/listings/report%2F1/images/order',
  );
  expect(fetcher.mock.calls[0]![1]).toMatchObject({
    method: 'PUT',
    signal,
    body: JSON.stringify({ imageIds: ids }),
  });
});
