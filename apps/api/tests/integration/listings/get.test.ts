import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { db } from '@/db';
import { listings, users } from '@/db/schema';
import { createListing, findListingById } from '@/listings/service';

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

describe('findListingById', () => {
  test('returns an existing listing', async () => {
    const user = await createUser();

    const createdListing = await createListing({
      createdByUserId: user.id,
      kind: 'lost',
      title: 'Black backpack',
      description: 'Black backpack with a laptop sleeve.',
      location: 'TU Berlin',
      occurredOn: '2026-09-01',
    });

    const listing = await findListingById(createdListing.id);

    expect(listing).toEqual(createdListing);
  });

  test('returns null when the listing does not exist', async () => {
    const listing = await findListingById('00000000-0000-4000-8000-000000000000');

    expect(listing).toBeNull();
  });
});
