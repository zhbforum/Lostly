import { afterAll, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { CONVERSATION_IMAGE_CONSTRAINTS } from '@lostly/contracts/conversations';
import { db } from '@/db';
import { claimMessages, claimMessageAttachments } from '@/db/conversations';
import { claims } from '@/db/schema';
import { clearDatabase, conversationFixture } from './fixtures';
import { attachmentValues, seedAttachmentMessage } from './attachment-fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

async function expectConstraint(query: PromiseLike<unknown>, code = '23514') {
  await expect(Promise.resolve(query)).rejects.toMatchObject({ cause: { errno: code } });
}

test('nullable bodies preserve the nonempty 2000-code-point constraint for text', async () => {
  const fixture = await conversationFixture();
  const { message } = await seedAttachmentMessage(fixture, 'Original', []);
  for (const body of [null, 'Text', '😀'.repeat(2000)]) {
    const [updated] = await db
      .update(claimMessages)
      .set({ body })
      .where(eq(claimMessages.id, message.id))
      .returning();
    expect(updated!.body).toBe(body);
  }
  for (const body of ['', 'a'.repeat(2001), '😀'.repeat(2001)]) {
    await expectConstraint(
      db.update(claimMessages).set({ body }).where(eq(claimMessages.id, message.id)),
    );
  }
});

test('attachment ordering, object keys, primary keys and parent references are constrained', async () => {
  const fixture = await conversationFixture();
  const { message, attachments } = await seedAttachmentMessage(fixture, null, [0, 1, 2, 3]);
  expect(attachments).toHaveLength(CONVERSATION_IMAGE_CONSTRAINTS.maxCount);
  await expectConstraint(
    db.insert(claimMessageAttachments).values(attachmentValues(message.id, 0)),
    '23505',
  );
  const other = await seedAttachmentMessage(fixture, 'Another message', []);
  await expectConstraint(
    db.insert(claimMessageAttachments).values({
      ...attachmentValues(other.message.id),
      objectKey: attachments[0]!.objectKey,
    }),
    '23505',
  );
  await expectConstraint(
    db.insert(claimMessageAttachments).values({
      ...attachmentValues(other.message.id),
      id: attachments[0]!.id,
    }),
    '23505',
  );
  await expectConstraint(
    db.insert(claimMessageAttachments).values(attachmentValues(crypto.randomUUID())),
    '23503',
  );
  // Identical source files are allowed at different positions, including in another message.
  await db.insert(claimMessageAttachments).values(attachmentValues(other.message.id));
});

test.each([
  { position: -1 },
  { position: 4 },
  { sizeBytes: 0 },
  { sizeBytes: -1 },
  { sizeBytes: CONVERSATION_IMAGE_CONSTRAINTS.maxSizeBytes + 1 },
  { width: 0 },
  { width: -1 },
  { height: 0 },
  { height: -1 },
  { contentType: 'image/jpeg' },
  { contentType: 'image/png' },
  { contentType: 'IMAGE/WEBP' },
  { sourceHash: '' },
  { sourceHash: 'a'.repeat(63) },
  { sourceHash: 'a'.repeat(65) },
  { sourceHash: 'A'.repeat(64) },
  { sourceHash: 'g'.repeat(64) },
  { sourceHash: 'a'.repeat(63) + '\n' },
])('rejects invalid attachment metadata: %j', async (invalid) => {
  const fixture = await conversationFixture();
  const { message } = await seedAttachmentMessage(fixture, 'Text', []);
  await expectConstraint(
    db.insert(claimMessageAttachments).values({ ...attachmentValues(message.id), ...invalid }),
  );
});

test('accepts the maximum normalized size and cascades attachment deletion through messages and claims', async () => {
  const fixture = await conversationFixture();
  const first = await seedAttachmentMessage(fixture);
  const second = await seedAttachmentMessage(fixture);
  await db
    .update(claimMessageAttachments)
    .set({ sizeBytes: CONVERSATION_IMAGE_CONSTRAINTS.maxSizeBytes })
    .where(eq(claimMessageAttachments.messageId, first.message.id));
  await db.delete(claimMessages).where(eq(claimMessages.id, first.message.id));
  expect((await db.select().from(claimMessageAttachments)).map((row) => row.messageId)).toEqual([
    second.message.id,
  ]);
  await db.delete(claims).where(eq(claims.id, fixture.claim.id));
  expect(await db.select().from(claimMessageAttachments)).toEqual([]);
});
