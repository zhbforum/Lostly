import { expect, spyOn, test } from 'bun:test';
import { request as httpRequest } from 'node:http';
import { createApp } from '@/app';
import { LEGACY_REQUEST_MAX_BYTES } from '@/http/body-limit';
import { MemoryObjectStorage } from '@tests/support/memory-storage';

test('existing login endpoint rejects chunked, valid padded JSON before its decoder', async () => {
  const api = createApp(new MemoryObjectStorage()).listen({ hostname: '127.0.0.1', port: 0 });
  const decode = spyOn(Request.prototype, 'json');
  let client: ReturnType<typeof httpRequest> | undefined;
  try {
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      client = httpRequest(
        new URL('/auth/login', api.server!.url),
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
      client.write(
        JSON.stringify({ email: 'bounded@example.com', password: 'valid-shape-password' }),
      );
      client.end(' '.repeat(LEGACY_REQUEST_MAX_BYTES));
    });
    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: 'REQUEST_TOO_LARGE' } });
    expect(decode).not.toHaveBeenCalled();
  } finally {
    client?.destroy();
    decode.mockRestore();
    await api.stop(true);
  }
});

test('the raised ceiling does not apply to JSON send, adjacent paths or other methods', async () => {
  const api = createApp(new MemoryObjectStorage());
  const id = crypto.randomUUID();
  const paths = [
    { path: `/conversations/${id}/messages`, method: 'POST', type: 'application/json' },
    {
      path: `/conversations/${id}/messages`,
      method: 'PUT',
      type: 'multipart/form-data; boundary=test',
    },
    {
      path: `/conversations/${id}/messages/${id}/attachments/refresh`,
      method: 'POST',
      type: 'multipart/form-data; boundary=test',
    },
    { path: '/auth/logout', method: 'POST', type: 'text/plain' },
  ];
  for (const { path, method, type } of paths) {
    const response = await api.handle(
      new Request('http://localhost' + path, {
        method,
        headers: { 'Content-Type': type, 'X-CSRF-Protection': '1' },
        body: new Blob([new Uint8Array(LEGACY_REQUEST_MAX_BYTES + 1)]).stream(),
      }),
    );
    expect(response.status).toBe(413);
  }
});
