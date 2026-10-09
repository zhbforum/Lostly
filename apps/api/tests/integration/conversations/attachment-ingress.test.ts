import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { Elysia } from 'elysia';
import { request as httpRequest } from 'node:http';
import { createConversationRoutes } from '@/conversations/routes';
import { createListingImageRoutes } from '@/listing-images/routes';
import { createImageUploadInfrastructure } from '@/image-upload/infrastructure';
import { errorHandler } from '@/http/errors';
import { legacyBodyLimit, LEGACY_REQUEST_MAX_BYTES } from '@/http/body-limit';
import { CONVERSATION_MESSAGE_REQUEST_MAX_BYTES } from '@/conversations/multipart';
import { MemoryObjectStorage } from '@tests/support/memory-storage';
import { imageFixture } from '@tests/support/image-fixture';
import { clearDatabase, conversationFixture, user, report } from './fixtures';
import { multipartRequest } from './attachment-send-fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

function setup(timeoutMs = 2000) {
  const storage = new MemoryObjectStorage();
  const infrastructure = createImageUploadInfrastructure();
  const api = new Elysia({ serve: { maxRequestBodySize: CONVERSATION_MESSAGE_REQUEST_MAX_BYTES } })
    .use(errorHandler)
    .use(legacyBodyLimit)
    .use(createListingImageRoutes(storage, infrastructure))
    .use(createConversationRoutes(storage, infrastructure, { bodyReadTimeoutMs: timeoutMs }));
  return { api, storage, infrastructure };
}
function raw(
  conversationId: string,
  cookie: string,
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
) {
  return new Request(`http://localhost/conversations/${conversationId}/messages`, {
    method: 'POST',
    body,
    signal,
    headers: {
      Cookie: cookie,
      'Idempotency-Key': crypto.randomUUID(),
      'Content-Type': 'multipart/form-data; boundary=test',
    },
  });
}

test('shared admission retains the user slot after body acceptance and disconnect until the attempt finishes', async () => {
  const fixture = await conversationFixture();
  const { api, storage } = setup();
  const image = await imageFixture();
  const key = crypto.randomUUID();
  const first = await api.handle(
    multipartRequest(fixture.conversation.id, fixture.owner.cookie, [image], '', key),
  );
  expect(first.status).toBe(201);
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const put = storage.put.bind(storage);
  const upload = spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
    entered.resolve();
    await resume.promise;
    await put(...args);
  });
  const abort = new AbortController();
  const pending = api.handle(
    multipartRequest(
      fixture.conversation.id,
      fixture.owner.cookie,
      [image],
      '',
      crypto.randomUUID(),
      abort.signal,
    ),
  );
  try {
    await entered.promise;
    abort.abort();
    // Even a persisted replay must pass ingress before it can bypass processing/quota.
    expect(
      (
        await api.handle(
          multipartRequest(fixture.conversation.id, fixture.owner.cookie, [image], '', key),
        )
      ).status,
    ).toBe(429);
    const listingForm = new FormData();
    listingForm.append('file', image);
    expect(
      (
        await api.handle(
          new Request(`http://localhost/listings/${fixture.listing.id}/images`, {
            method: 'POST',
            body: listingForm,
            headers: { Cookie: fixture.owner.cookie, 'Idempotency-Key': crypto.randomUUID() },
          }),
        )
      ).status,
    ).toBe(429);
    expect(
      (
        await api.handle(
          multipartRequest(fixture.conversation.id, fixture.claimant.cookie, [image]),
        )
      ).status,
    ).toBe(201);
    resume.resolve();
    expect((await pending).status).toBe(201);
    expect(
      (
        await api.handle(
          multipartRequest(fixture.conversation.id, fixture.owner.cookie, [image], '', key),
        )
      ).status,
    ).toBe(200);
  } finally {
    resume.resolve();
    await pending;
    upload.mockRestore();
  }
});

test('malformed parser and header validation exits release the slot; unauthenticated bytes are not read', async () => {
  const { api } = setup();
  const fixture = await conversationFixture();
  for (let i = 0; i < 5; i++) {
    const bad = new FormData();
    bad.append('body', 'no image');
    const response = await api.handle(
      new Request(`http://localhost/conversations/${fixture.conversation.id}/messages`, {
        method: 'POST',
        body: bad,
        headers: { Cookie: fixture.owner.cookie, 'Idempotency-Key': crypto.randomUUID() },
      }),
    );
    expect(response.status).toBe(400);
  }
  const noKey = multipartRequest(fixture.conversation.id, fixture.owner.cookie, [
    await imageFixture(),
  ]);
  noKey.headers.delete('Idempotency-Key');
  expect((await api.handle(noKey)).status).toBe(422);
  let reads = 0;
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>(
    {
      pull() {
        reads++;
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  expect((await api.handle(raw(fixture.conversation.id, '', source))).status).toBe(401);
  expect(reads).toBe(0);
  expect(cancelled).toBe(true);
  expect(
    (
      await api.handle(
        multipartRequest(fixture.conversation.id, fixture.owner.cookie, [await imageFixture()]),
      )
    ).status,
  ).toBe(201);
});

test('multipart abort and absolute body deadline release admission', async () => {
  const { api } = setup(25);
  const fixture = await conversationFixture();
  expect(
    (await api.handle(raw(fixture.conversation.id, fixture.owner.cookie, new ReadableStream())))
      .status,
  ).toBe(408);
  const abort = new AbortController();
  const started = Promise.withResolvers<void>();
  const pending = api.handle(
    raw(
      fixture.conversation.id,
      fixture.owner.cookie,
      new ReadableStream(
        {
          pull() {
            started.resolve();
          },
        },
        { highWaterMark: 0 },
      ),
      abort.signal,
    ),
  );
  await started.promise;
  abort.abort();
  expect((await pending).status).toBe(400);
  expect(
    (
      await api.handle(
        multipartRequest(fixture.conversation.id, fixture.owner.cookie, [await imageFixture()]),
      )
    ).status,
  ).toBe(201);
});

test('global four-attempt cap is shared by listing and conversation routes', async () => {
  const { api } = setup(5000);
  const fixture = await conversationFixture();
  const others = await Promise.all([0, 1, 2].map((i) => user(`shared-${i}`)));
  const reports = await Promise.all(others.map((other) => report(other.id)));
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  const ready = Array.from({ length: 4 }, () => Promise.withResolvers<void>());
  const streams = ready.map(
    (barrier) =>
      new ReadableStream<Uint8Array>(
        {
          pull() {
            barrier.resolve();
          },
        },
        { highWaterMark: 0 },
      ),
  );
  const pending = [
    api.handle(
      raw(fixture.conversation.id, fixture.owner.cookie, streams[0]!, controllers[0]!.signal),
    ),
    ...others.map((other, i) =>
      api.handle(
        new Request(`http://localhost/listings/${reports[i]!.id}/images`, {
          method: 'POST',
          body: streams[i + 1]!,
          signal: controllers[i + 1]!.signal,
          headers: {
            Cookie: other.cookie,
            'Idempotency-Key': crypto.randomUUID(),
            'Content-Type': 'multipart/form-data; boundary=test',
          },
        }),
      ),
    ),
  ];
  try {
    await Promise.all(ready.map((barrier) => barrier.promise));
    const rejected = await api.handle(
      multipartRequest(fixture.conversation.id, fixture.claimant.cookie, [await imageFixture()]),
    );
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get('Retry-After')).toBe('60');
  } finally {
    controllers.forEach((controller) => controller.abort());
    await Promise.all(pending);
  }
});

test('real HTTP applies 180-second multipart idle override while retaining a shorter body deadline', async () => {
  const { api, storage } = setup(50);
  const fixture = await conversationFixture();
  api.listen({ hostname: '127.0.0.1', port: 0, idleTimeout: 1 });
  const timeout = spyOn(api.server!, 'timeout');
  const put = storage.put.bind(storage);
  const upload = spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
    await Bun.sleep(1500);
    await put(...args); // Longer than this server's configured idle timeout.
  });
  const request = multipartRequest(fixture.conversation.id, fixture.owner.cookie, [
    await imageFixture(),
  ]);
  const endpoint = new URL(new URL(request.url).pathname, api.server!.url);
  let client: ReturnType<typeof httpRequest> | undefined;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: request.headers,
      body: await request.blob(),
    });
    expect(response.status).toBe(201);
    await response.arrayBuffer();
    expect(timeout.mock.calls.some(([, seconds]) => seconds === 180)).toBe(true);
    const stalled = new Promise<number>((resolve, reject) => {
      client = httpRequest(
        endpoint,
        {
          method: 'POST',
          headers: {
            Cookie: fixture.owner.cookie,
            'Idempotency-Key': crypto.randomUUID(),
            'Content-Type': 'multipart/form-data; boundary=test',
          },
        },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode!));
        },
      );
      client.on('error', reject);
      client.write('--test\r\n');
    });
    expect(await stalled).toBe(408);
  } finally {
    client?.destroy();
    timeout.mockRestore();
    upload.mockRestore();
    await api.stop(true);
  }
}, 10000);

test('a request above the legacy ceiling is accepted only for conversation multipart, not listing multipart', async () => {
  const { api } = setup();
  const fixture = await conversationFixture();
  const image = await imageFixture('jpeg');
  const padded = new Blob([image, new Uint8Array(3 * 1024 * 1024 - image.size)]);
  const sent = await api.handle(
    multipartRequest(fixture.conversation.id, fixture.owner.cookie, [padded, padded]),
  );
  expect(sent.status).toBe(201);
  const file = new Blob([new Uint8Array(LEGACY_REQUEST_MAX_BYTES + 1)]);
  const form = new FormData();
  form.append('file', file);
  const listing = await api.handle(
    new Request(`http://localhost/listings/${fixture.listing.id}/images`, {
      method: 'POST',
      body: form,
      headers: { Cookie: fixture.owner.cookie, 'Idempotency-Key': crypto.randomUUID() },
    }),
  );
  expect(listing.status).toBe(413);
});
