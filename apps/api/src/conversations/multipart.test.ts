import { expect, spyOn, test } from 'bun:test';
import { normalizeMessageBody } from '@/domain/conversation';
import { CONVERSATION_MESSAGE_REQUEST_MAX_BYTES, parseSendRequest } from './multipart';

function request(body: RequestInit['body'], type?: string, signal?: AbortSignal) {
  return new Request('http://localhost/conversations/test/messages', {
    method: 'POST',
    body,
    signal,
    headers: type ? { 'Content-Type': type } : {},
  });
}
function form(count = 1, body?: string) {
  const data = new FormData();
  if (body !== undefined) data.append('body', body);
  for (let i = 0; i < count; i++) data.append('images', new Blob([String(i)]), `private-${i}`);
  return data;
}

test.each([1, 4])('accepts %i images in wire order and an optional body', async (count) => {
  for (const body of [undefined, '', 'Caption']) {
    const parsed = await parseSendRequest(request(form(count, body)));
    expect(parsed.kind).toBe('multipart');
    if (parsed.kind !== 'multipart') throw new Error('Expected multipart');
    expect(parsed.body).toBe(body ?? '');
    expect(await Promise.all(parsed.images.map((image) => image.text()))).toEqual(
      Array.from({ length: count }, (_, i) => String(i)),
    );
  }
});

test.each(['no images', 'five images', 'duplicate body', 'unknown', 'string image', 'file body'])(
  'rejects malformed multipart: %s',
  async (variant) => {
    const data = form(variant === 'no images' ? 0 : variant === 'five images' ? 5 : 1, '');
    if (variant === 'duplicate body') data.append('body', 'second');
    if (variant === 'unknown') data.append('extra', 'value');
    if (variant === 'string image') data.append('images', 'not-file');
    if (variant === 'file body') {
      data.delete('body');
      data.append('body', new Blob(['caption']));
    }
    await expect(parseSendRequest(request(data))).rejects.toMatchObject({
      reason: 'invalid-multipart',
    });
  },
);

test('distinguishes unsupported media, malformed multipart, broken JSON and strict JSON shape', async () => {
  for (const type of [
    'text/plain',
    'application/octet-stream',
    'application/x-www-form-urlencoded',
  ])
    await expect(parseSendRequest(request('body', type))).rejects.toMatchObject({
      reason: 'unsupported-media-type',
    });
  await expect(parseSendRequest(request('body', 'multipart/form-data'))).rejects.toMatchObject({
    reason: 'invalid-multipart',
  });
  await expect(parseSendRequest(request('{', 'application/json'))).rejects.toMatchObject({
    code: 'PARSE',
  });
  for (const value of [
    null,
    [],
    {},
    { body: 1 },
    { body: 'ok', images: [] },
    { body: 'x'.repeat(8001) },
  ])
    await expect(
      parseSendRequest(request(JSON.stringify(value), 'application/json')),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  expect(
    await parseSendRequest(request('{"body":"hello"}', 'Application/JSON; charset=utf-8')),
  ).toEqual({ kind: 'json', body: 'hello' });
});

test('Content-Length rejects before reading; actual stream bytes are independently bounded', async () => {
  const early = request(
    new ReadableStream({}, { highWaterMark: 0 }),
    'multipart/form-data; boundary=test',
  );
  early.headers.set('Content-Length', String(CONVERSATION_MESSAGE_REQUEST_MAX_BYTES + 1));
  const reader = spyOn(early.body!, 'getReader');
  try {
    await expect(parseSendRequest(early)).rejects.toMatchObject({ reason: 'body-too-large' });
    expect(reader).not.toHaveBeenCalled();
  } finally {
    reader.mockRestore();
  }
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    parseSendRequest(request(stream, 'multipart/form-data; boundary=test')),
  ).rejects.toMatchObject({ reason: 'body-too-large' });
  expect(cancelled).toBe(true);
});

test('read timeout and abort retain their public failure reasons', async () => {
  await expect(
    parseSendRequest(request(new ReadableStream(), 'multipart/form-data; boundary=test'), 10),
  ).rejects.toMatchObject({ reason: 'body-timeout' });
  const abort = new AbortController();
  const pending = parseSendRequest(
    request(new ReadableStream(), 'multipart/form-data; boundary=test', abort.signal),
  );
  abort.abort();
  await expect(pending).rejects.toMatchObject({ reason: 'upload-aborted' });
});

test('validates the decoded JS string: malformed wire UTF-8 becomes permitted replacement characters', async () => {
  const bytes = Buffer.concat([
    Buffer.from('--test\r\nContent-Disposition: form-data; name="body"\r\n\r\n'),
    Buffer.from([0xff]),
    Buffer.from(
      '\r\n--test\r\nContent-Disposition: form-data; name="images"; filename="x"\r\nContent-Type: application/octet-stream\r\n\r\nx\r\n--test--\r\n',
    ),
  ]);
  const parsed = await parseSendRequest(request(bytes, 'multipart/form-data; boundary=test'));
  expect(normalizeMessageBody(parsed.body)).toEqual({ status: 'text', body: '\uFFFD' });
});
