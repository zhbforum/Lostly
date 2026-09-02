import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { app } from '@/app';
import { db } from '@/db';
import { listings, users } from '@/db/schema';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from '@/http/csrf';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl?.endsWith('/lostly_test')) {
  throw new Error('Integration tests require the lostly_test database');
}

const PASSWORD = 'correct horse battery staple';

interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

async function clearDatabase() {
  await db.delete(listings);
  await db.delete(users);
}

beforeEach(clearDatabase);
afterAll(clearDatabase);

function postJson(path: string, body: unknown, cookie?: string) {
  const headers = new Headers({
    'content-type': 'application/json',
    [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE,
  });

  if (cookie) {
    headers.set('cookie', cookie);
  }

  return app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  );
}

function getCookieHeader(response: Response): string {
  const setCookie = response.headers.get('set-cookie');

  if (!setCookie) {
    throw new Error('Expected Set-Cookie header');
  }

  const [cookie] = setCookie.split(';');

  if (!cookie) {
    throw new Error('Expected session cookie');
  }

  return cookie;
}

async function registerUser(): Promise<{
  cookie: string;
  user: AuthenticatedUser;
}> {
  const response = await postJson('/auth/register', {
    email: 'user@example.com',
    password: PASSWORD,
    displayName: 'Test User',
  });

  if (response.status !== 201) {
    throw new Error(`Failed to register test user: ${response.status}`);
  }

  const body = (await response.json()) as {
    user: AuthenticatedUser;
  };

  return {
    cookie: getCookieHeader(response),
    user: body.user,
  };
}

describe('POST /listings', () => {
  test('creates a listing for the authenticated user', async () => {
    const { cookie, user } = await registerUser();

    const response = await postJson(
      '/listings',
      {
        kind: 'lost',
        title: '  Black backpack  ',
        description: '  Black backpack with a laptop sleeve.  ',
        location: '  TU Berlin  ',
        occurredOn: '2026-09-01',
      },
      cookie,
    );

    expect(response.status).toBe(201);

    expect(await response.json()).toMatchObject({
      listing: {
        createdByUserId: user.id,
        kind: 'lost',
        status: 'active',
        title: 'Black backpack',
        description: 'Black backpack with a laptop sleeve.',
        location: 'TU Berlin',
        occurredOn: '2026-09-01',
      },
    });

    const storedListings = await db.select().from(listings);

    expect(storedListings).toHaveLength(1);
    expect(storedListings[0]).toMatchObject({
      createdByUserId: user.id,
      kind: 'lost',
      status: 'active',
      title: 'Black backpack',
      description: 'Black backpack with a laptop sleeve.',
      location: 'TU Berlin',
      occurredOn: '2026-09-01',
    });
  });

  test('rejects a request without authentication', async () => {
    const response = await postJson('/listings', {
      kind: 'found',
      title: 'Keys',
      description: 'Found a set of keys.',
      location: 'TU Berlin',
      occurredOn: '2026-09-01',
    });

    expect(response.status).toBe(401);

    expect(await response.json()).toEqual({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });

    expect(await db.select().from(listings)).toHaveLength(0);
  });

  test('rejects input that becomes invalid after trimming', async () => {
    const { cookie } = await registerUser();

    const response = await postJson(
      '/listings',
      {
        kind: 'lost',
        title: '   ',
        description: 'Missing item',
        location: 'TU Berlin',
        occurredOn: '2026-09-01',
      },
      cookie,
    );

    expect(response.status).toBe(422);
    expect(await db.select().from(listings)).toHaveLength(0);
  });

  test('rejects an invalid occurrence date', async () => {
    const { cookie } = await registerUser();

    const response = await postJson(
      '/listings',
      {
        kind: 'lost',
        title: 'Black backpack',
        description: 'Missing backpack',
        location: 'TU Berlin',
        occurredOn: 'not-a-date',
      },
      cookie,
    );

    expect(response.status).toBe(422);
    expect(await db.select().from(listings)).toHaveLength(0);
  });

  test('does not allow overriding server-controlled listing fields', async () => {
    const { cookie } = await registerUser();

    const [otherUser] = await db
      .insert(users)
      .values({
        email: 'other@example.com',
        passwordHash: 'test-password-hash',
        displayName: 'Other User',
      })
      .returning();

    if (!otherUser) {
      throw new Error('Failed to create second test user');
    }

    const response = await postJson(
      '/listings',
      {
        kind: 'lost',
        status: 'resolved',
        createdByUserId: otherUser.id,
        title: 'Black backpack',
        description: 'Missing backpack',
        location: 'TU Berlin',
        occurredOn: '2026-09-01',
      },
      cookie,
    );

    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      listing: {
        createdByUserId: string;
        status: string;
      };
    };

    expect(body.listing.createdByUserId).not.toBe(otherUser.id);
    expect(body.listing.status).toBe('active');

    const [storedListing] = await db.select().from(listings);

    expect(storedListing?.createdByUserId).toBe(body.listing.createdByUserId);
    expect(storedListing?.createdByUserId).not.toBe(otherUser.id);
    expect(storedListing?.status).toBe('active');
  });
});
