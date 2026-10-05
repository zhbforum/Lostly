import { expect, spyOn, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import { request as httpRequest } from 'node:http';
import { legacyBodyLimit, LEGACY_REQUEST_MAX_BYTES, nativeRequest } from './body-limit';

const jsonSchema = t.Object({ value: t.String() });
function app() {
  return new Elysia({ serve: { maxRequestBodySize: 22 * 1024 * 1024 } })
    .use(legacyBodyLimit)
    .post('/json', ({ body }) => body, { body: jsonSchema })
    .post('/explicit', ({ body }) => body, { parse: 'json', body: jsonSchema })
    .post('/form', ({ body }) => body, { parse: 'urlencoded', body: jsonSchema })
    .post('/multipart', ({ body }) => body, { parse: 'formdata', body: jsonSchema })
    .post('/ignored', () => 'ok', { parse: 'none' })
    .post('/conversations/:id/messages', ({ request }) => ({ used: request.bodyUsed }), {
      parse: 'none',
    });
}

test('rejects actual oversized bytes before the automatic JSON decoder, including valid padded JSON', async () => {
  const api = app();
  const decode = spyOn(Request.prototype, 'json');
  try {
    const chunk = new TextEncoder().encode(' '.repeat(64 * 1024));
    let remaining = LEGACY_REQUEST_MAX_BYTES + chunk.length;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"ok"}'));
      },
      pull(controller) {
        if (remaining <= 0) controller.close();
        else {
          controller.enqueue(chunk);
          remaining -= chunk.length;
        }
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await api.handle(
      new Request('http://localhost/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stream,
      }),
    );
    expect(response.status).toBe(413);
    expect(decode).not.toHaveBeenCalled();
    expect(cancelled).toBe(true);
  } finally {
    decode.mockRestore();
  }
});

test('preserves inferred/explicit JSON, form, ignored-body and malformed JSON semantics', async () => {
  const api = app();
  for (const path of ['/json', '/explicit']) {
    const response = await api.handle(
      new Request('http://localhost' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"value":"ok"}',
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ value: 'ok' });
    expect(
      (
        await api.handle(
          new Request('http://localhost' + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{',
          }),
        )
      ).status,
    ).toBe(400);
  }
  for (const multipart of [false, true]) {
    const form = new FormData();
    form.set('value', 'ok');
    const response = await api.handle(
      new Request('http://localhost' + (multipart ? '/multipart' : '/form'), {
        method: 'POST',
        body: multipart ? form : new URLSearchParams({ value: 'ok' }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ value: 'ok' });
  }
  expect(
    (
      await api.handle(
        new Request('http://localhost/ignored', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{',
        }),
      )
    ).status,
  ).toBe(200);
});

test('does not read multipart upload bodies, but limits JSON on the same conversation endpoint', async () => {
  const api = app();
  let reads = 0;
  const source = new ReadableStream<Uint8Array>(
    {
      pull() {
        reads++;
      },
    },
    { highWaterMark: 0 },
  );
  const response = await api.handle(
    new Request('http://localhost/conversations/id/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=test' },
      body: source,
    }),
  );
  expect(await response.json()).toEqual({ used: false });
  expect(reads).toBe(0);
  for (const path of ['/conversations/id/messages', '/ignored']) {
    expect(
      (
        await api.handle(
          new Request('http://localhost' + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: ' '.repeat(LEGACY_REQUEST_MAX_BYTES + 1),
          }),
        )
      ).status,
    ).toBe(413);
  }
});

test('enforces chunked HTTP bytes and retains the native request for IP lookup', async () => {
  const api = app()
    .post('/ip', ({ request, server }) => ({
      address: server?.requestIP(nativeRequest(request))?.address,
    }))
    .listen({ hostname: '127.0.0.1', port: 0 });
  try {
    const response = await new Promise<number>((resolve, reject) => {
      const client = httpRequest(
        new URL('/json', api.server!.url),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode!));
        },
      );
      client.on('error', reject);
      client.write('{"value":"ok"}');
      client.end(' '.repeat(LEGACY_REQUEST_MAX_BYTES));
    });
    expect(response).toBe(413);
    const ip = await fetch(new URL('/ip', api.server!.url), { method: 'POST', body: 'hello' });
    expect(await ip.json()).toMatchObject({ address: '127.0.0.1' });
  } finally {
    await api.stop(true);
  }
});
