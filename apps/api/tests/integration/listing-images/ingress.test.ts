import { afterAll, beforeEach, expect, test, spyOn } from 'bun:test';
import { Elysia } from 'elysia';
import { request as httpRequest } from 'node:http';
import { createListingImageRoutes } from '@/listing-images/routes';
import { errorHandler } from '@/http/errors';
import { db } from '@/db';
import { sessions } from '@/db/schema';
import { generateSessionToken, getSessionExpiresAt, hashSessionToken } from '@/auth/session';
import { clearDatabase, report, user } from '@tests/integration/listings/management-fixtures';
import { imageFixture } from '@tests/support/image-fixture';
import { MemoryObjectStorage } from '@tests/support/memory-storage';

beforeEach(clearDatabase);
afterAll(clearDatabase);

function setup(bodyReadTimeoutMs = 2000) {
  const storage = new MemoryObjectStorage();
  const app = new Elysia()
    .use(errorHandler)
    .use(createListingImageRoutes(storage, { bodyReadTimeoutMs }));
  return { app, storage };
}
function request(
  id: string,
  cookie: string,
  body: FormData | ReadableStream<Uint8Array>,
  signal?: AbortSignal,
) {
  return new Request(`http://localhost/listings/${id}/images`, {
    method: 'POST',
    body,
    signal,
    headers: {
      Cookie: cookie,
      'X-CSRF-Protection': '1',
      'Idempotency-Key': crypto.randomUUID(),
      ...(body instanceof ReadableStream
        ? { 'Content-Type': 'multipart/form-data; boundary=test' }
        : {}),
    },
  });
}
async function form() {
  const form = new FormData();
  form.append('file', await imageFixture());
  return form;
}
function stalled() {
  const started = Promise.withResolvers<void>();
  const abort = new AbortController();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull() {
        started.resolve();
        return new Promise<void>(() => {});
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return {
    body,
    abort,
    started: started.promise,
    get cancelled() {
      return cancelled;
    },
  };
}

test('limits by verified user across sessions before reading, while another user can upload', async () => {
  const { app } = setup();
  const owner = await user('ingress-owner');
  const other = await user('ingress-other');
  const listing = await report(owner.id);
  const otherListing = await report(other.id);
  const token = generateSessionToken();
  await db.insert(sessions).values({
    userId: owner.id,
    tokenHash: hashSessionToken(token),
    expiresAt: getSessionExpiresAt(),
  });
  const slow = stalled();
  const pending = app.handle(request(listing.id, owner.cookie, slow.body, slow.abort.signal));
  try {
    await slow.started;
    const rejected = stalled();
    const response = await app.handle(
      request(listing.id, `lostly_session=${token}`, rejected.body),
    );
    expect(response.status).toBe(429);
    expect(rejected.cancelled).toBe(true);
    expect((await app.handle(request(otherListing.id, other.cookie, await form()))).status).toBe(
      201,
    );
  } finally {
    slow.abort.abort();
    expect((await pending).status).toBe(400);
  }
  expect(slow.cancelled).toBe(true);
  expect((await app.handle(request(listing.id, owner.cookie, await form()))).status).toBe(201);
});

test('times out multipart reads with 408 and releases both user and global slots', async () => {
  const { app, storage } = setup(30);
  const owner = await user('ingress-timeout');
  const listing = await report(owner.id);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slow = stalled();
    const response = await app.handle(request(listing.id, owner.cookie, slow.body));
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 408,
      body: { error: { code: 'IMAGE_UPLOAD_TIMEOUT', message: expect.any(String) } },
    });
    expect(slow.cancelled).toBe(true);
  }
  expect(storage.objects.size).toBe(0);
  expect((await app.handle(request(listing.id, owner.cookie, await form()))).status).toBe(201);
});

test('retains the global cap across different users and releases disconnected reads', async () => {
  const { app } = setup();
  const owners = await Promise.all(
    Array.from({ length: 5 }, (_, i) => user(`ingress-global-${i}`)),
  );
  const reports = await Promise.all(owners.map((owner) => report(owner.id)));
  const streams = owners.slice(0, 4).map(() => stalled());
  const pending = streams.map((slow, i) =>
    app.handle(request(reports[i]!.id, owners[i]!.cookie, slow.body, slow.abort.signal)),
  );
  try {
    await Promise.all(streams.map((slow) => slow.started));
    const rejected = stalled();
    const rejectedRequest = request(reports[4]!.id, owners[4]!.cookie, rejected.body);
    const cancel = spyOn(rejectedRequest.body!, 'cancel');
    try {
      expect((await app.handle(rejectedRequest)).status).toBe(429);
      expect(rejected.cancelled).toBe(true);
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      cancel.mockRestore();
    }
  } finally {
    streams.forEach((slow) => slow.abort.abort());
    await Promise.all(pending);
  }
  expect((await app.handle(request(reports[4]!.id, owners[4]!.cookie, await form()))).status).toBe(
    201,
  );
});

test('keeps the user slot until storage settles, including after a disconnect', async () => {
  const { app, storage } = setup();
  const owner = await user('ingress-storage');
  const other = await user('ingress-storage-other');
  const listing = await report(owner.id);
  const otherListing = await report(other.id);
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const put = storage.put.bind(storage);
  const spy = spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
    started.resolve();
    await finish.promise;
    await put(...args);
  });
  const abort = new AbortController();
  const pending = app.handle(request(listing.id, owner.cookie, await form(), abort.signal));
  try {
    await started.promise;
    abort.abort();
    expect((await app.handle(request(listing.id, owner.cookie, await form()))).status).toBe(429);
    expect((await app.handle(request(otherListing.id, other.cookie, await form()))).status).toBe(
      201,
    );
  } finally {
    finish.resolve();
    await pending;
    spy.mockRestore();
  }
  expect((await app.handle(request(listing.id, owner.cookie, await form()))).status).toBe(201);
});

test('enforces the body deadline over a real HTTP connection and accepts the next upload', async () => {
  const { app } = setup(50);
  const owner = await user('ingress-http-timeout');
  const listing = await report(owner.id);
  app.listen({ hostname: '127.0.0.1', port: 0 });
  const endpoint = new URL(`/listings/${listing.id}/images`, app.server!.url);
  const client = httpRequest(endpoint, {
    method: 'POST',
    headers: {
      Cookie: owner.cookie,
      'Content-Type': 'multipart/form-data; boundary=test',
      'Idempotency-Key': crypto.randomUUID(),
    },
  });
  try {
    const response = new Promise<number>((resolve, reject) => {
      client.on('error', reject);
      client.on('response', (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
        response.on('error', reject);
      });
    });
    // Start a chunked request and deliberately never finish its body.
    client.write('--test\r\n');
    expect(await response).toBe(408);
    const next = await fetch(endpoint, {
      method: 'POST',
      body: await form(),
      headers: { Cookie: owner.cookie, 'Idempotency-Key': crypto.randomUUID() },
    });
    expect(next.status).toBe(201);
    await next.arrayBuffer();
  } finally {
    client.destroy();
    await app.stop(true);
  }
});
