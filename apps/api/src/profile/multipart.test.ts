import { expect, mock, spyOn, test } from 'bun:test';
import { AVATAR_REQUEST_MAX_BYTES, parseAvatarUpload } from './multipart';

function request(body?: RequestInit['body'], signal?: AbortSignal) {
  return new Request('http://localhost/me/profile/avatar', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=test' },
    body,
    signal,
  });
}

test.each([
  { name: 'missing body', body: undefined },
  { name: 'malformed multipart framing', body: 'not a multipart body' },
])('maps $name to the profile multipart error', async ({ body }) => {
  await expect(parseAvatarUpload(request(body))).rejects.toMatchObject({
    name: 'ProfileError',
    reason: 'invalid-multipart',
  });
});

test('rejects an oversized Content-Length before reading the avatar body', async () => {
  const pull = mock(() => {});
  const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
  const upload = request(body);
  upload.headers.set('Content-Length', String(AVATAR_REQUEST_MAX_BYTES + 1));

  try {
    await expect(parseAvatarUpload(upload)).rejects.toMatchObject({
      name: 'ProfileError',
      reason: 'body-too-large',
    });
    expect(pull).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  } finally {
    await body.cancel();
  }
});

test('maps an oversized avatar stream to the profile size error and cancels it', async () => {
  const cancel = mock(() => {});
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(AVATAR_REQUEST_MAX_BYTES + 1));
    },
    cancel,
  });

  await expect(parseAvatarUpload(request(body))).rejects.toMatchObject({
    name: 'ProfileError',
    reason: 'body-too-large',
  });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(body.locked).toBe(false);
});

test('maps a stalled avatar read to the profile timeout error and cancels it', async () => {
  const cancel = mock(() => {});
  const body = new ReadableStream<Uint8Array>({ cancel });
  const controller = new AbortController();
  const schedule = spyOn(globalThis, 'setTimeout');
  const pending = parseAvatarUpload(request(body, controller.signal));

  try {
    expect(schedule).toHaveBeenCalledTimes(1);
    const expire = schedule.mock.calls[0]![0];
    expire();

    await expect(pending).rejects.toMatchObject({
      name: 'ProfileError',
      reason: 'body-timeout',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  } finally {
    controller.abort();
    await Promise.allSettled([pending]);
    schedule.mockRestore();
  }
});

test('maps a disconnected avatar upload to the profile abort error and releases its reader', async () => {
  const cancel = mock(() => {});
  const body = new ReadableStream<Uint8Array>({ cancel });
  const controller = new AbortController();
  const pending = parseAvatarUpload(request(body, controller.signal));

  controller.abort();

  await expect(pending).rejects.toMatchObject({
    name: 'ProfileError',
    reason: 'upload-aborted',
  });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(body.locked).toBe(false);
});
