import { expect, spyOn, test } from 'bun:test';
import { request as httpRequest } from 'node:http';
import { createApp } from '@/app';
import * as bodyReader from '@/image-upload/read-body';
import { MemoryObjectStorage } from '@tests/support/memory-storage';

function streamedRequest(path: string, csrf = true) {
  let reads = 0;
  const chunks = ['{', '}'];
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        reads++;
        controller.enqueue(new TextEncoder().encode(chunks.shift()!));
        if (!chunks.length) controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (csrf) headers.set('X-CSRF-Protection', '1');
  return {
    request: new Request('http://localhost' + path, { method: 'POST', headers, body }),
    reads: () => reads,
  };
}

test.each([
  ['/auth/login', 20],
  ['/auth/register', 5],
] as const)(
  'production %s limiter rejects before any body read, after CSRF',
  async (path, limit) => {
    // Match the production composition in index.ts, not an isolated limiter plugin.
    const api = createApp(new MemoryObjectStorage(), { authRateLimit: true });

    const csrf = streamedRequest(path, false);
    expect((await api.handle(csrf.request)).status).toBe(403);
    expect(csrf.reads()).toBe(0);

    for (let attempt = 0; attempt < limit; attempt++) {
      const allowed = streamedRequest(path);
      // Invalid shape avoids DB/password work while exercising the real route and parser.
      expect((await api.handle(allowed.request)).status).toBe(422);
      expect(allowed.reads()).toBe(2);
    }

    const blocked = streamedRequest(path);
    expect(blocked.request.headers.has('Content-Length')).toBe(false);
    const response = await api.handle(blocked.request);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(blocked.reads()).toBe(0);
    expect(blocked.request.bodyUsed).toBe(false);

    const csrfAfterLimit = streamedRequest(path, false);
    expect((await api.handle(csrfAfterLimit.request)).status).toBe(403);
    expect(csrfAfterLimit.reads()).toBe(0);
  },
);

test('listening production server rejects an unfinished chunked auth body without invoking its reader', async () => {
  const api = createApp(new MemoryObjectStorage(), { authRateLimit: true }).listen({
    hostname: '127.0.0.1',
    port: 0,
  });
  const read = spyOn(bodyReader, 'readBoundedRequestBody');
  let client: ReturnType<typeof httpRequest> | undefined;
  try {
    const url = new URL('/auth/register', api.server!.url);
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
        body: '{}',
      });
      expect(response.status).toBe(422);
      await response.arrayBuffer();
    }
    expect(read).toHaveBeenCalledTimes(5);
    read.mockClear();

    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      client = httpRequest(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => resolve({ status: response.statusCode!, body }));
          response.on('error', reject);
        },
      );
      client.on('error', reject);
      client.setTimeout(2000, () => client?.destroy(new Error('Limiter waited for body bytes')));
      // No Content-Length or end(): the server must respond before the body can complete.
      client.write('{');
    });
    expect(response.status).toBe(429);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(read).not.toHaveBeenCalled();
  } finally {
    client?.destroy();
    read.mockRestore();
    await api.stop(true);
  }
});
