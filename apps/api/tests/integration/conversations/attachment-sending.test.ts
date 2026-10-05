import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { db } from '@/db';
import { claimMessages, claimMessageAttachments } from '@/db/conversations';
import { claims, listings, users } from '@/db/schema';
import { sendClaimMessage } from '@/conversations/send';
import * as imageProcessing from '@/image-upload/processing';
import { clearDatabase, conversationFixture, user } from './fixtures';
import { imageFixture, animatedPngFixture, pngChunk } from '@tests/support/image-fixture';
import {
  attachmentHttpApp,
  attachmentSendFixture,
  multipartRequest,
} from './attachment-send-fixtures';
import type {
  ClaimMessageResponse,
  ConversationInboxResponse,
  ConversationMessagesResponse,
} from '@lostly/contracts/conversations';

beforeEach(clearDatabase);
afterAll(clearDatabase);

test.each([1, 4])(
  'HTTP sends %i images, normalizes caption, preserves source hashes/order and returns private URLs',
  async (count) => {
    const fixture = await conversationFixture();
    const { api, storage } = attachmentHttpApp();
    const images = await Promise.all(
      Array.from({ length: count }, (_, index) =>
        imageFixture('jpeg', index % 2 ? '#ff0000' : '#00ff00'),
      ),
    );
    const hashes = await Promise.all(
      images.map(async (image) =>
        createHash('sha256')
          .update(Buffer.from(await image.arrayBuffer()))
          .digest('hex'),
      ),
    );
    const response = await api.handle(
      multipartRequest(
        fixture.conversation.id,
        fixture.claimant.cookie,
        images,
        count === 1 ? ' \r\n ' : ' caption\r\ntext ',
      ),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const { message } = (await response.json()) as ClaimMessageResponse;
    expect(message.body).toBe(count === 1 ? null : 'caption\ntext');
    expect(message.attachments.map((a) => a.position)).toEqual(
      Array.from({ length: count }, (_, i) => i),
    );
    expect(message.attachments[0]).toMatchObject({ kind: 'image', width: 32, height: 24 });
    expect(Date.parse(message.attachments[0]!.urlExpiresAt) - Date.now()).toBeGreaterThan(890_000);
    const rows = await db
      .select()
      .from(claimMessageAttachments)
      .orderBy(claimMessageAttachments.position);
    expect(rows.map((row) => row.sourceHash)).toEqual(hashes);
    for (const row of rows) {
      expect(row.objectKey).toMatch(
        new RegExp(
          `^conversations/${fixture.conversation.id}/[0-9a-f-]{36}/${row.position}\\.webp$`,
        ),
      );
      const metadata = await sharp(
        Buffer.from(await storage.objects.get(row.objectKey)!.arrayBuffer()),
      ).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.exif).toBeUndefined();
    }
    const inbox = (await (
      await api.handle(
        new Request('http://localhost/me/conversations', {
          headers: { Cookie: fixture.owner.cookie },
        }),
      )
    ).json()) as ConversationInboxResponse;
    expect(inbox.conversations[0]).toMatchObject({
      unreadCount: 1,
      lastMessage: { attachmentCount: count, body: message.body },
    });
    expect(JSON.stringify(inbox.conversations[0]!.lastMessage)).not.toContain('url');
    const history = (await (
      await api.handle(
        new Request(`http://localhost/conversations/${fixture.conversation.id}/messages?limit=1`, {
          headers: { Cookie: fixture.owner.cookie },
        }),
      )
    ).json()) as ConversationMessagesResponse;
    expect(history.messages[0]!.attachments.map((a) => a.id)).toEqual(
      message.attachments.map((a) => a.id),
    );
  },
);

test('single source reads, duplicate images and non-authoritative MIME work through the send pipeline', async () => {
  const { send, input } = await attachmentSendFixture();
  const source = await imageFixture('jpeg');
  const first = new File([source], 'untrusted.bin', { type: 'application/octet-stream' });
  const second = new File([source], 'different-name', { type: 'text/html' });
  const reads = [spyOn(first, 'arrayBuffer'), spyOn(second, 'arrayBuffer')];
  try {
    expect(await send({ ...input, images: [first, second] })).toMatchObject({
      ok: true,
      value: { created: true, message: { body: null } },
    });
    expect(reads.every((read) => read.mock.calls.length === 1)).toBe(true);
    const rows = await db.select().from(claimMessageAttachments);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.sourceHash).toBe(rows[1]!.sourceHash);
  } finally {
    reads.forEach((read) => read.mockRestore());
  }
});

test('replay compares normalized body and ordered original hashes before capacity/quota; JSON crosses conflict', async () => {
  const { send, input, storage, quota, processing } = await attachmentSendFixture();
  const second = await imageFixture('png', '#ff0000');
  input.body = ' Caption\r\ntext ';
  input.images.push(second);
  const first = await send(input);
  expect(first).toMatchObject({ ok: true, value: { created: true } });
  const capacity = spyOn(processing, 'tryAcquire').mockReturnValue(null);
  const prepare = spyOn(imageProcessing, 'prepareImage');
  const put = spyOn(storage, 'put');
  try {
    const replay = await send({ ...input, body: 'Caption\ntext' });
    expect(replay).toMatchObject({ ok: true, value: { created: false } });
    if (first.ok && replay.ok) expect(replay.value.message.id).toBe(first.value.message.id);
    for (const change of [
      { body: 'changed' },
      { images: [second, input.images[0]!] },
      { images: [second, second] },
      { images: [second] },
      { images: [...input.images, second] },
    ])
      expect(await send({ ...input, ...change })).toEqual({
        ok: false,
        reason: 'idempotency-conflict',
      });
    expect(await sendClaimMessage({ ...input, body: 'Caption\ntext' }, quota)).toEqual({
      ok: false,
      reason: 'idempotency-conflict',
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(capacity).not.toHaveBeenCalled();
    expect(quota).toHaveBeenCalledTimes(1);
    await expect(send({ ...input, clientOperationId: crypto.randomUUID() })).rejects.toMatchObject({
      reason: 'busy',
    });
    expect(quota).toHaveBeenCalledTimes(1);
  } finally {
    capacity.mockRestore();
    prepare.mockRestore();
    put.mockRestore();
  }
  const key = crypto.randomUUID();
  await sendClaimMessage({ ...input, body: 'text', clientOperationId: key }, quota);
  expect(await send({ ...input, body: 'text', clientOperationId: key })).toEqual({
    ok: false,
    reason: 'idempotency-conflict',
  });
});

test('rejected replay is readable, rejected new send consumes no quota, hidden replay fails until restore', async () => {
  const fixture = await attachmentSendFixture();
  const { send, input, quota, claim, listing } = fixture;
  await send(input);
  await db.update(claims).set({ status: 'rejected' }).where(eq(claims.id, claim.id));
  expect(await send(input)).toMatchObject({ ok: true, value: { created: false } });
  expect(await send({ ...input, clientOperationId: crypto.randomUUID() })).toEqual({
    ok: false,
    reason: 'conversation-read-only',
  });
  expect(quota).toHaveBeenCalledTimes(1);
  expect(fixture.storage.objects.size).toBe(1);
  await db.update(listings).set({ isHidden: true }).where(eq(listings.id, listing.id));
  expect(await send(input)).toEqual({ ok: false, reason: 'conversation-not-found' });
  await db.update(listings).set({ isHidden: false }).where(eq(listings.id, listing.id));
  expect(await send(input)).toMatchObject({ ok: true, value: { created: false } });
});

test('preflight denies stranger/admin before source reads; participant admin retains access', async () => {
  const { send, input } = await attachmentSendFixture();
  const outsider = await user('outsider');
  const read = spyOn(input.images[0]!, 'arrayBuffer');
  try {
    for (const role of ['user', 'admin'] as const) {
      await db.update(users).set({ role }).where(eq(users.id, outsider.id));
      expect(await send({ ...input, userId: outsider.id })).toEqual({
        ok: false,
        reason: 'conversation-not-found',
      });
    }
    expect(read).not.toHaveBeenCalled();
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, input.userId));
    expect(await send(input)).toMatchObject({ ok: true });
  } finally {
    read.mockRestore();
  }
});

test('invalid text never becomes valid because images are present', async () => {
  const { send, input, quota } = await attachmentSendFixture();
  for (const body of ['\0', '\ud800', '😀'.repeat(2001)])
    expect(await send({ ...input, body })).toEqual({ ok: false, reason: 'invalid-message' });
  expect(quota).not.toHaveBeenCalled();
  expect(await db.select().from(claimMessages)).toEqual([]);
});

test('HTTP rejects corrupt, animated, oversized and pixel-bomb sources with 422', async () => {
  const { conversation, owner } = await conversationFixture();
  const { api, storage } = attachmentHttpApp();
  const png = Buffer.from(await (await imageFixture()).arrayBuffer());
  const header = Buffer.from(png.subarray(16, 29));
  header.writeUInt32BE(10000, 0);
  header.writeUInt32BE(10000, 4);
  const other = Buffer.from(await (await imageFixture('png', '#ff0000')).arrayBuffer());
  const animated = await sharp([png, other], { join: { animated: true } })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  for (const image of [
    new Blob(['garbage'], { type: 'image/jpeg' }),
    await animatedPngFixture(),
    new Blob([new Uint8Array(animated)]),
    new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]),
    new Blob([
      new Uint8Array(
        Buffer.concat([png.subarray(0, 8), pngChunk('IHDR', header), png.subarray(33)]),
      ),
    ]),
  ]) {
    const response = await api.handle(multipartRequest(conversation.id, owner.cookie, [image]));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  }
  expect(storage.objects.size).toBe(0);
  expect(await db.select().from(claimMessages)).toEqual([]);
});
