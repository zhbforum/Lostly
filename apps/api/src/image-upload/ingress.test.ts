import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import * as authService from '@/auth/service';
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

function authenticatedUpload(userId: string, signal?: AbortSignal) {
  const pull = mock(() => {});
  const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
  const request = new Request('http://localhost/upload', {
    method: 'POST',
    body,
    signal,
    headers: { Cookie: `lostly_session=${userId}` },
  });
  return { request, pull, cancel: spyOn(body, 'cancel') };
}

function auth(userId: string) {
  return {
    session: { id: 'session', userId, expiresAt: new Date(Date.now() + 60_000) },
    user: { id: userId, email: 'test@example.com', displayName: 'Test', role: 'user' as const },
  };
}

test('reserves four global slots before asynchronous authentication and never reads the body', async () => {
  const ingress = createImageUploadIngress();
  const resumeAuth = Promise.withResolvers<void>();
  const authenticate = spyOn(authService, 'getSession').mockImplementation(async (token) => {
    await resumeAuth.promise;
    return auth(token);
  });
  const uploads = Array.from({ length: 4 }, (_, i) => authenticatedUpload(`user-${i}`));
  const pending = uploads.map(({ request }) => ingress.begin(request, 'test-ip'));
  const rejected = authenticatedUpload('user-5');
  try {
    expect(authenticate).toHaveBeenCalledTimes(4);
    expect(await ingress.begin(rejected.request, 'test-ip')).toEqual({ ok: false, reason: 'busy' });
    expect(authenticate).toHaveBeenCalledTimes(4);
    expect(rejected.cancel).toHaveBeenCalledTimes(1);
    resumeAuth.resolve();
    expect(await Promise.all(pending)).toEqual(
      uploads.map((_, i) => ({ ok: true, userId: `user-${i}` })),
    );
    for (const upload of [...uploads, rejected]) expect(upload.pull).not.toHaveBeenCalled();
    ingress.finish(uploads[0]!.request);
    const next = authenticatedUpload('user-next');
    try {
      expect(await ingress.begin(next.request, 'test-ip')).toEqual({
        ok: true,
        userId: 'user-next',
      });
    } finally {
      ingress.finish(next.request);
    }
  } finally {
    resumeAuth.resolve();
    await Promise.allSettled(pending);
    uploads.forEach(({ request }) => ingress.finish(request));
  }
});

test('authentication errors and aborted uploads cancel the body and leave no reserved slots', async () => {
  const ingress = createImageUploadIngress();
  const authenticate = spyOn(authService, 'getSession').mockRejectedValue(
    new Error('Auth unavailable'),
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    const upload = authenticatedUpload('user');
    await expect(ingress.begin(upload.request, 'test-ip')).rejects.toThrow('Auth unavailable');
    expect(upload.cancel).toHaveBeenCalledTimes(1);
    expect(upload.pull).not.toHaveBeenCalled();
  }
  authenticate.mockImplementation(async (token) => auth(token));
  const controller = new AbortController();
  const aborted = authenticatedUpload('user', controller.signal);
  controller.abort();
  expect(await ingress.begin(aborted.request, 'test-ip')).toEqual({
    ok: false,
    reason: 'upload-aborted',
  });
  expect(aborted.cancel).toHaveBeenCalledTimes(1);
  expect(aborted.pull).not.toHaveBeenCalled();
  const next = authenticatedUpload('user');
  try {
    expect(await ingress.begin(next.request, 'test-ip')).toEqual({ ok: true, userId: 'user' });
    const sameUser = authenticatedUpload('user');
    expect(await ingress.begin(sameUser.request, 'different-ip')).toEqual({
      ok: false,
      reason: 'busy',
    });
    expect(sameUser.cancel).toHaveBeenCalledTimes(1);
    expect(sameUser.pull).not.toHaveBeenCalled();
  } finally {
    ingress.finish(next.request);
  }
});

test('cancels an unauthenticated upload exactly once, even after response cleanup', async () => {
  const ingress = createImageUploadIngress();
  const { request, cancel } = upload();

  expect(await ingress.begin(request, 'test-ip')).toEqual({ ok: false, reason: 'unauthenticated' });
  ingress.finish(request);
  ingress.finish(request);

  expect(cancel).toHaveBeenCalledTimes(1);
});

test('shares the IP budget across route consumers and cancels a rate-limited body exactly once', async () => {
  const ingress = createImageUploadIngress();
  for (let attempt = 0; attempt < 30; attempt++) {
    const request = new Request(`http://localhost/consumer-${attempt % 2}/images`, {
      method: 'POST',
    });
    expect(await ingress.begin(request, 'test-ip')).toEqual({
      ok: false,
      reason: 'unauthenticated',
    });
  }
  const { request, cancel } = upload();

  expect(await ingress.begin(request, 'test-ip')).toEqual({ ok: false, reason: 'busy' });
  ingress.finish(request);

  expect(cancel).toHaveBeenCalledTimes(1);
  expect(await ingress.begin(new Request('http://localhost/upload'), 'other-ip')).toEqual({
    ok: false,
    reason: 'unauthenticated',
  });
});

test('ignores response cleanup for requests that never entered upload ingress', () => {
  const ingress = createImageUploadIngress();
  const { request, cancel } = upload();

  ingress.finish(request);

  expect(cancel).not.toHaveBeenCalled();
});
