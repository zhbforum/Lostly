import { eq } from 'drizzle-orm';
import { db } from '@/db';
import type { UpdateListingInput } from '@lostly/contracts/listings';
import { claims, listings, sessions, users } from '@/db/schema';
import { claimConversations, claimConversationMembers } from '@/db/conversations';
import { app } from '@/app';
import { generateSessionToken, getSessionExpiresAt, hashSessionToken } from '@/auth/session';

if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== '/lostly_test')
  throw new Error('Management integration tests require lostly_test');

export async function clearDatabase() {
  await db.delete(claims);
  await db.delete(listings);
  await db.delete(users);
}

export async function user(name: string) {
  const [record] = await db
    .insert(users)
    .values({
      email: name + '@example.com',
      displayName: name,
      passwordHash: 'unused-test-hash',
    })
    .returning();
  if (!record) throw new Error('Missing fixture user');
  const token = generateSessionToken();
  await db.insert(sessions).values({
    userId: record.id,
    tokenHash: hashSessionToken(token),
    expiresAt: getSessionExpiresAt(),
  });
  return { id: record.id, cookie: 'lostly_session=' + token };
}

export const editableInput = {
  title: 'Updated backpack',
  description: 'Updated description',
  location: 'Updated location',
  occurredOn: '2026-09-02',
};
export const updateInput = { ...editableInput, expectedVersion: 1 } satisfies UpdateListingInput;
export const fixtureTime = new Date('2026-01-01T00:00:00.000Z');

export async function report(
  ownerId: string,
  kind: 'found' | 'lost' = 'found',
  status: 'active' | 'resolved' | 'archived' = 'active',
) {
  const [record] = await db
    .insert(listings)
    .values({
      createdByUserId: ownerId,
      kind,
      status,
      title: 'Blue backpack',
      description: 'Original description',
      location: 'Berlin',
      occurredOn: '2026-09-01',
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    })
    .returning();
  if (!record) throw new Error('Missing fixture listing');
  return record;
}

export async function claim(
  listingId: string,
  claimantUserId: string,
  status: 'pending' | 'approved' | 'rejected' = 'pending',
  reviewerId?: string,
) {
  return db.transaction(async (tx) => {
    const [listing] = await tx
      .select({ ownerId: listings.createdByUserId })
      .from(listings)
      .where(eq(listings.id, listingId));
    if (!listing) throw new Error('Missing fixture listing');
    const [record] = await tx
      .insert(claims)
      .values({
        listingId,
        claimantUserId,
        status,
        verificationDetails: 'Private proof of ownership.',
        handoverDetails: status === 'approved' ? 'Collect from library reception.' : null,
        reviewedByUserId: reviewerId ?? null,
        reviewedAt: reviewerId ? fixtureTime : null,
        createdAt: fixtureTime,
        updatedAt: fixtureTime,
      })
      .returning();
    if (!record) throw new Error('Missing fixture claim');
    const [conversation] = await tx
      .insert(claimConversations)
      .values({ claimId: record.id, createdAt: fixtureTime })
      .returning();
    if (!conversation) throw new Error('Missing fixture conversation');
    await tx.insert(claimConversationMembers).values(
      [claimantUserId, listing.ownerId].map((userId) => ({
        conversationId: conversation.id,
        userId,
        createdAt: fixtureTime,
      })),
    );
    return record;
  });
}

export function request(
  path: string,
  cookie?: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
) {
  const headers = new Headers({ 'X-CSRF-Protection': '1' });
  if (cookie) headers.set('cookie', cookie);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return app.handle(
    new Request('http://localhost' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
