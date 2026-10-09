import { expect, test } from 'bun:test';
import { IMAGE_REQUEST_MAX_BYTES, parseImageUpload } from './multipart';

test('accepts exactly one file and rejects extra and duplicated fields', async () => {
  const form = new FormData();
  form.append('file', new File(['image bytes'], 'photo.png'));
  const parse = () =>
    parseImageUpload(new Request('http://localhost/upload', { method: 'POST', body: form }));
  expect((await parse()).file.size).toBe(11);
  form.append('file', new File(['more'], 'photo.png'));
  await expect(parse()).rejects.toMatchObject({ reason: 'invalid-multipart' });
  form.delete('file');
  form.append('file', 'text');
  await expect(parse()).rejects.toMatchObject({ reason: 'invalid-multipart' });
});

test('bounds a streamed body without trusting Content-Length', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request('http://localhost/upload', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'multipart/form-data; boundary=test', 'Content-Length': '1' },
  });
  await expect(parseImageUpload(request)).rejects.toMatchObject({ reason: 'body-too-large' });
  expect(cancelled).toBe(true);
});

test('rejects an oversized declared body and malformed multipart', async () => {
  await expect(
    parseImageUpload(
      new Request('http://localhost/upload', {
        method: 'POST',
        body: 'x',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=test',
          'Content-Length': String(IMAGE_REQUEST_MAX_BYTES + 1),
        },
      }),
    ),
  ).rejects.toMatchObject({ reason: 'body-too-large' });
  await expect(
    parseImageUpload(
      new Request('http://localhost/upload', {
        method: 'POST',
        body: 'x',
        headers: { 'Content-Type': 'multipart/form-data; boundary=test' },
      }),
    ),
  ).rejects.toMatchObject({ reason: 'invalid-multipart' });
});

test('maps shared missing-body, timeout and abort failures back to listing errors', async () => {
  const empty = new Request('http://localhost/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=test' },
  });
  await expect(parseImageUpload(empty)).rejects.toMatchObject({
    name: 'ImageError',
    reason: 'invalid-multipart',
  });
  const stalled = (signal?: AbortSignal) =>
    new Request('http://localhost/upload', {
      method: 'POST',
      signal,
      body: new ReadableStream<Uint8Array>(),
      headers: { 'Content-Type': 'multipart/form-data; boundary=test' },
    });
  await expect(parseImageUpload(stalled(), 20)).rejects.toMatchObject({
    name: 'ImageError',
    reason: 'body-timeout',
  });
  const abort = new AbortController();
  abort.abort();
  await expect(parseImageUpload(stalled(abort.signal))).rejects.toMatchObject({
    name: 'ImageError',
    reason: 'upload-aborted',
  });
});
