import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { BunSQLSession } from 'drizzle-orm/bun-sql';
import type { ClaimMessageResponse } from '@lostly/contracts/conversations';
import { db } from '@/db';
import { claimMessages, claimMessageAttachments } from '@/db/conversations';
import * as attachments from '@/conversations/attachments';
import { StorageUnavailableError } from '@/storage/object-storage';
import { clearDatabase, conversationFixture } from './fixtures';
import { app, jsonOf, origin, request, send, storage } from './http-fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

test('text sends and replays return empty attachments without post-commit hydration or signing', async () => {
  const { conversation, owner } = await conversationFixture();
  const hydrate = spyOn(attachments, 'hydrateMessages').mockRejectedValue(
    new Error('Attachment read unavailable'),
  );
  const sign = spyOn(storage, 'createReadUrl').mockImplementation(() => {
    throw new StorageUnavailableError();
  });
  const execute = spyOn(BunSQLSession.prototype, 'prepareQuery');
  try {
    const key = crypto.randomUUID();
    const sent = await jsonOf<ClaimMessageResponse>(
      send(conversation.id, owner.cookie, 'Text only', key),
      201,
    );
    expect(sent.message).toMatchObject({ body: 'Text only', attachments: [] });
    expect(
      await jsonOf<ClaimMessageResponse>(send(conversation.id, owner.cookie, 'Text only', key)),
    ).toEqual(sent);
    expect(hydrate).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
    expect(
      execute.mock.calls.some(([query]) => query.sql.includes('claim_message_attachments')),
    ).toBe(false);
  } finally {
    execute.mockRestore();
    sign.mockRestore();
    hydrate.mockRestore();
  }
});

test.each(
  [
    {},
    { body: null },
    { body: '' },
    { body: '  \r\n ' },
    { body: '\0' },
    { body: '\ud800' },
    { body: '😀'.repeat(2001) },
    { attachments: [] },
    { images: ['image.webp'] },
    { body: 'Caption', images: ['image.webp'] },
  ].map((body, index) => [index, body] as const),
)(
  'text-only HTTP send still rejects empty, invalid and attachment-shaped JSON case %i',
  async (_index, body) => {
    const { conversation, owner } = await conversationFixture();
    await jsonOf(
      request(`/conversations/${conversation.id}/messages`, owner.cookie, body, 'POST', {
        'Idempotency-Key': crypto.randomUUID(),
      }),
      422,
    );
    expect(await db.select().from(claimMessages)).toEqual([]);
    expect(await db.select().from(claimMessageAttachments)).toEqual([]);
  },
);

test('multipart attachment sends are not supported in the persistence stage', async () => {
  const { conversation, owner } = await conversationFixture();
  const form = new FormData();
  form.append('images', new Blob(['not-an-upload-pipeline'], { type: 'image/webp' }), 'image.webp');
  const response = await app.handle(
    new Request(`http://localhost/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: {
        Cookie: owner.cookie,
        Origin: origin,
        'X-CSRF-Protection': '1',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: form,
    }),
  );
  expect(response.status).toBe(400);
  expect(await db.select().from(claimMessages)).toEqual([]);
  expect(await db.select().from(claimMessageAttachments)).toEqual([]);
});
