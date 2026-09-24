import { expect, test } from 'bun:test';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/lostly_test';
const { app } = await import('@/app');
const id = '550e8400-e29b-41d4-a716-446655440001';
const base = `/conversations/${id}`;

function request(path: string, body?: unknown, extra: Record<string, string> = {}) {
  return app.handle(
    new Request('http://localhost' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Protection': '1',
        'Idempotency-Key': id,
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

test.each([
  ['/me/conversations', undefined],
  ['/me/conversations/unread-count', undefined],
  [base, undefined],
  [base + '/messages', undefined],
  [base + '/messages', { body: 'Text' }],
  [base + '/read', { messageId: id }],
] as const)('conversation endpoints require a session: %s', async (path, body) => {
  expect((await request(path, body)).status).toBe(401);
});

test.each([
  '/conversations/not-a-uuid',
  '/conversations/not-a-uuid/messages',
  '/me/conversations?limit=0',
  '/me/conversations?limit=51',
  '/me/conversations?limit=1.5',
  base + '/messages?before=0',
  base + '/messages?after=-1',
  base + '/messages?after=NaN',
  base + '/messages?before=2147483648',
  base + '/messages?after=2147483648',
  base + '/messages?limit=101',
  base + '/messages?limit=0',
  base + '/messages?limit=1.5',
])('rejects invalid conversation path/query fields: %s', async (path) => {
  const response = await request(path);
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({
    error: { code: 'VALIDATION_ERROR', message: 'Request fields are invalid' },
  });
});

test.each(
  [
    null,
    [],
    {},
    { body: 42 },
    { body: null },
    { body: 'x'.repeat(8001) },
    { body: 'private', senderUserId: id },
    { body: 'private', userId: id },
    { body: 'private', conversationId: id },
    { body: 'private', clientOperationId: id },
    { body: 'private', participants: [id] },
  ].map((body, index) => [index, body] as const),
)('rejects malformed send body and metadata case %i', async (_index, body) => {
  const response = await request(base + '/messages', body);
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({
    error: { code: 'VALIDATION_ERROR', message: 'Request fields are invalid' },
  });
});

test.each(
  [
    null,
    [],
    {},
    { messageId: 42 },
    { messageId: 'invalid' },
    { messageId: id, userId: id },
    { messageId: id, lastReadSequence: 42 },
  ].map((body, index) => [index, body] as const),
)('rejects malformed read body and pointer override case %i', async (_index, body) => {
  expect((await request(base + '/read', body)).status).toBe(422);
});

test.each([undefined, 'invalid', `${id}, ${id}`])(
  'requires one UUID idempotency header: %s',
  async (key) => {
    const headers = new Headers({ 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' });
    if (key !== undefined) headers.set('Idempotency-Key', key);
    const response = await app.handle(
      new Request('http://localhost' + base + '/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify({ body: 'private' }),
      }),
    );
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain('private');
  },
);

test.each(['messages', 'read'])(
  'requires CSRF protection and safely rejects broken JSON for %s',
  async (suffix) => {
    for (const csrf of ['', 'wrong']) {
      const response = await request(
        base + '/' + suffix,
        suffix === 'messages' ? { body: 'private' } : { messageId: id },
        { 'X-CSRF-Protection': csrf },
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'CSRF_VALIDATION_FAILED' } });
    }
    const broken = await app.handle(
      new Request('http://localhost' + base + '/' + suffix, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Protection': '1',
          'Idempotency-Key': id,
        },
        body: '{"private-message":',
      }),
    );
    expect(broken.status).toBe(400);
    expect(await broken.json()).toEqual({
      error: { code: 'INVALID_JSON', message: 'Request body could not be parsed' },
    });
  },
);

test('OpenAPI documents all conversation endpoints, security, pagination and retry headers without private examples', async () => {
  const response = await request('/openapi/json');
  expect(response.status).toBe(200);
  const spec = (await response.json()) as {
    tags: { name: string }[];
    paths: Record<
      string,
      Record<
        string,
        {
          tags: string[];
          security: unknown;
          description: string;
          parameters?: {
            name: string;
            required: boolean;
            schema: { format?: string; minimum?: number; maximum?: number };
          }[];
          responses: Record<
            string,
            {
              headers?: Record<string, { schema: { minimum?: number } }>;
              content?: Record<string, unknown>;
            }
          >;
          requestBody?: {
            content: Record<
              string,
              { schema: { additionalProperties?: boolean; properties: Record<string, unknown> } }
            >;
          };
        }
      >
    >;
  };
  expect(spec.tags.some((tag) => tag.name === 'Conversations')).toBe(true);
  for (const [path, method] of [
    ['/me/conversations', 'get'],
    ['/me/conversations/unread-count', 'get'],
    ['/conversations/{conversationId}', 'get'],
    ['/conversations/{conversationId}/messages', 'get'],
    ['/conversations/{conversationId}/messages', 'post'],
    ['/conversations/{conversationId}/read', 'post'],
  ] as const) {
    const operation = spec.paths[path]![method]!;
    expect(operation.tags).toEqual(['Conversations']);
    expect(operation.security).toEqual(
      method === 'get' ? [{ sessionCookie: [] }] : [{ sessionCookie: [], csrfProtection: [] }],
    );
    expect(operation.responses['401']).toBeDefined();
    expect(operation.responses['200']).toBeDefined();
    expect(JSON.stringify(operation)).not.toMatch(/"examples?"\s*:/);
  }
  const send = spec.paths['/conversations/{conversationId}/messages']!.post!;
  expect(send.parameters).toContainEqual(
    expect.objectContaining({
      name: 'idempotency-key',
      required: true,
      schema: expect.objectContaining({ format: 'uuid' }),
    }),
  );
  const body = send.requestBody!.content['application/json']!.schema;
  expect(Object.keys(body.properties)).toEqual(['body']);
  expect(body.additionalProperties).toBe(false);
  for (const code of ['201', '400', '403', '404', '409', '422', '429'])
    expect(send.responses[code]).toBeDefined();
  expect(send.responses['429']!.headers!['Retry-After']!.schema.minimum).toBe(1);
  expect(send.responses['429']!.content!['application/json']).toBeDefined();
  const history = spec.paths['/conversations/{conversationId}/messages']!.get!;
  expect(history.parameters).toContainEqual(
    expect.objectContaining({ name: 'after', schema: expect.objectContaining({ minimum: 0 }) }),
  );
  expect(history.parameters).toContainEqual(
    expect.objectContaining({ name: 'before', schema: expect.objectContaining({ minimum: 1 }) }),
  );
  expect(history.parameters).toContainEqual(
    expect.objectContaining({ name: 'limit', schema: expect.objectContaining({ maximum: 100 }) }),
  );
  expect(spec.paths['/me/conversations']!.get!.description).toContain(
    'does not provide a cross-request snapshot',
  );
});
