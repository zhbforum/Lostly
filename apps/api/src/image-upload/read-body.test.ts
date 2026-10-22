import { expect, mock, test } from 'bun:test';
import { readBoundedRequestBody } from './read-body';

function request(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  return new Request('http://localhost/upload', { method: 'POST', body, signal });
}

test('reports a missing body without multipart or domain-specific semantics', async () => {
  await expect(
    readBoundedRequestBody(new Request('http://localhost/upload', { method: 'POST' }), {
      maxBytes: 10,
      timeoutMs: 1000,
    }),
  ).rejects.toMatchObject({ reason: 'missing-body' });
});

test('enforces the actual byte count despite a smaller declared length and cancels the stream', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
    },
    cancel() {
      cancelled = true;
    },
  });
  const upload = new Request('http://localhost/upload', {
    method: 'POST',
    body,
    headers: { 'Content-Length': '1' },
  });
  await expect(
    readBoundedRequestBody(upload, { maxBytes: 5, timeoutMs: 1000 }),
  ).rejects.toMatchObject({ reason: 'body-too-large' });
  expect(cancelled).toBe(true);
  expect(body.locked).toBe(false);
});

test('cancels a stalled read at the deadline even when source cleanup never settles', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
      return new Promise<void>(() => {});
    },
  });
  await expect(
    readBoundedRequestBody(request(body), { maxBytes: 1024, timeoutMs: 20 }),
  ).rejects.toMatchObject({ reason: 'body-timeout' });
  expect(cancelled).toBe(true);
  expect(body.locked).toBe(false);
});

test('uses an absolute deadline, not an idle timeout reset by every chunk', async () => {
  let chunks = 0;
  let timer: ReturnType<typeof setInterval>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
      timer = setInterval(() => {
        chunks++;
        controller.enqueue(new Uint8Array([1]));
      }, 2);
    },
    cancel() {
      cancelled = true;
      clearInterval(timer);
    },
  });
  try {
    await expect(
      readBoundedRequestBody(request(body), { maxBytes: 1024 * 1024, timeoutMs: 30 }),
    ).rejects.toMatchObject({ reason: 'body-timeout' });
    expect(chunks).toBeGreaterThan(0);
    expect(cancelled).toBe(true);
  } finally {
    clearInterval(timer!);
  }
});

test.each([false, true])(
  'cancels a disconnected request (already aborted: %s)',
  async (alreadyAborted) => {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    if (alreadyAborted) controller.abort();
    const reading = readBoundedRequestBody(request(body, controller.signal), {
      maxBytes: 1024,
      timeoutMs: 1000,
    });
    controller.abort();
    await expect(reading).rejects.toMatchObject({ reason: 'upload-aborted' });
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  },
);

test('cleans up the abort listener after a successful read', async () => {
  const controller = new AbortController();
  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      stream.enqueue(new Uint8Array([1, 2]));
      stream.close();
    },
  });
  const result = await readBoundedRequestBody(request(body, controller.signal), {
    maxBytes: 2,
    timeoutMs: 1000,
  });
  controller.abort();
  expect(await result.bytes()).toEqual(new Uint8Array([1, 2]));
  expect(body.locked).toBe(false);
});

test('a failed source cancellation cannot replace the size-limit error', async () => {
  const cancel = mock(() => {
    throw new Error('Source cleanup failed');
  });
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
    },
    cancel,
  });

  await expect(readBoundedRequestBody(request(body), { maxBytes: 2 })).rejects.toMatchObject({
    reason: 'body-too-large',
  });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(body.locked).toBe(false);
});

test('a failed source cancellation cannot replace an in-flight abort or retain its reader', async () => {
  const cancel = mock(() => {
    throw new Error('Source cleanup failed');
  });
  const body = new ReadableStream<Uint8Array>({ cancel });
  const controller = new AbortController();
  const pending = readBoundedRequestBody(request(body, controller.signal), { maxBytes: 2 });

  controller.abort();

  await expect(pending).rejects.toMatchObject({ reason: 'upload-aborted' });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(body.locked).toBe(false);
});
