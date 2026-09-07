import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { listings, users } from '@/db/schema';
import { createListing } from '@/listings/service';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl?.endsWith('/lostly_test')) {
  throw new Error('Integration tests require the lostly_test database');
}

async function clearDatabase() {
  await db.delete(listings);
  await db.delete(users);
}

beforeEach(clearDatabase);
afterAll(clearDatabase);

async function createUser() {
  const [user] = await db
    .insert(users)
    .values({
      email: 'user@example.com',
      passwordHash: 'test-password-hash',
      displayName: 'Test User',
    })
    .returning();

  if (!user) {
    throw new Error('Failed to create test user');
  }

  return user;
}

describe('createListing', () => {
  test('creates and persists an active listing', async () => {
    const user = await createUser();

    const listing = await createListing({
      createdByUserId: user.id,
      kind: 'lost',
      title: 'Black backpack',
      description: 'Black backpack with a laptop sleeve.',
      location: 'TU Berlin',
      occurredOn: '2026-09-01',
    });

    expect(listing).toMatchObject({
      version: 1,
      kind: 'lost',
      status: 'active',
      title: 'Black backpack',
      description: 'Black backpack with a laptop sleeve.',
      location: 'TU Berlin',
      occurredOn: '2026-09-01',
    });
    expect(listing).not.toHaveProperty('createdByUserId');

    expect(listing.id).toBeDefined();
    expect(listing.createdAt).toBeInstanceOf(Date);
    expect(listing.updatedAt).toBeInstanceOf(Date);

    const [storedListing] = await db.select().from(listings).where(eq(listings.id, listing.id));

    expect(storedListing).toMatchObject({
      createdByUserId: user.id,
      kind: 'lost',
      status: 'active',
      title: 'Black backpack',
      description: 'Black backpack with a laptop sleeve.',
      location: 'TU Berlin',
      occurredOn: '2026-09-01',
    });
  });
});
