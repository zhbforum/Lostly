import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { createImageUploadIngress } from './ingress';

afterEach(() => mock.restore());

function upload() {
  const body = new ReadableStream<Uint8Array>();
  const request = new Request('http://localhost/listings/test/images', {
    method: 'POST',
    body,
  });
  return { request, cancel: spyOn(request.body!, 'cancel') };
}

test('cancels an unauthenticated upload exactly once, even after response cleanup', async () => {
  const ingress = createImageUploadIngress();
  const { request, cancel } = upload();

  expect(await ingress.begin(request, 'test-ip')).toBe(false);
  ingress.finish(request);
  ingress.finish(request);

  expect(cancel).toHaveBeenCalledTimes(1);
});

test('cancels a rate-limited upload exactly once before authentication', async () => {
  const ingress = createImageUploadIngress();
  for (let attempt = 0; attempt < 30; attempt++) {
    const request = new Request('http://localhost/listings/test/images', { method: 'POST' });
    expect(await ingress.begin(request, 'test-ip')).toBe(false);
  }
  const { request, cancel } = upload();

  await expect(ingress.begin(request, 'test-ip')).rejects.toMatchObject({ reason: 'busy' });
  ingress.finish(request);

  expect(cancel).toHaveBeenCalledTimes(1);
});

test('ignores response cleanup for requests that never entered upload ingress', () => {
  const ingress = createImageUploadIngress();
  const { request, cancel } = upload();

  ingress.finish(request);

  expect(cancel).not.toHaveBeenCalled();
});
