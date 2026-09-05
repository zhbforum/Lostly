import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import type { ListingResponse } from '@lostly/contracts/listings';
import { eq } from 'drizzle-orm';

import { app } from '@/app';
import { db } from '@/db';
import { listings, users } from '@/db/schema';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from '@/http/csrf';
import { createListing } from '@/listings/service';

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

function get(path: string, cookie?: string) {
  const headers = new Headers();

  if (cookie) {
    headers.set('cookie', cookie);
  }

  return app.handle(
    new Request(`http://localhost${path}`, {
      method: 'GET',
      headers,
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

    const body = (await response.json()) as ListingResponse;

    expect(body).toMatchObject({
      listing: {
        kind: 'lost',
        status: 'active',
        title: 'Black backpack',
        description: 'Black backpack with a laptop sleeve.',
        location: 'TU Berlin',
        occurredOn: '2026-09-01',
      },
    });
    expect(body.listing).not.toHaveProperty('createdByUserId');

    const [storedListing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, body.listing.id));

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
    const { cookie, user } = await registerUser();

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

    const body = (await response.json()) as ListingResponse;

    expect(body.listing.status).toBe('active');
    expect(body.listing).not.toHaveProperty('createdByUserId');

    const [storedListing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, body.listing.id));

    expect(storedListing?.createdByUserId).toBe(user.id);
    expect(storedListing?.createdByUserId).not.toBe(otherUser.id);
    expect(storedListing?.status).toBe('active');
  });
});

describe('GET /listings', () => {
  test('returns only active listings with filters and cursor pagination', async () => {
    const { cookie, user } = await registerUser();

    const firstFoundListing = await createListing({
      createdByUserId: user.id,
      kind: 'found',
      title: 'Blue backpack',
      description: 'Found near the library.',
      location: 'TU Berlin',
      occurredOn: '2026-09-01',
    });
    const secondFoundListing = await createListing({
      createdByUserId: user.id,
      kind: 'found',
      title: 'Silver water bottle',
      description: 'Found in the cafeteria.',
      location: 'TU Berlin',
      occurredOn: '2026-09-02',
    });
    const lostListing = await createListing({
      createdByUserId: user.id,
      kind: 'lost',
      title: 'Black headphones',
      description: 'Lost by the library.',
      location: 'TU Berlin',
      occurredOn: '2026-09-03',
    });

    await db.update(listings).set({ status: 'resolved' }).where(eq(listings.id, lostListing.id));

    const firstResponse = await get('/listings?kind=found&sort=newest&limit=1', cookie);
    expect(firstResponse.status).toBe(200);

    const firstPage = (await firstResponse.json()) as {
      listings: Array<{ id: string; kind: string; status: string }>;
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
    };

    expect(firstPage.listings).toHaveLength(1);
    expect(firstPage.listings[0]?.kind).toBe('found');
    expect(firstPage.listings[0]?.status).toBe('active');
    expect(firstPage.pageInfo.hasNextPage).toBe(true);
    expect(firstPage.pageInfo.endCursor).toBeTruthy();

    const secondResponse = await get(
      `/listings?kind=found&sort=newest&limit=1&cursor=${encodeURIComponent(firstPage.pageInfo.endCursor!)}`,
      cookie,
    );
    expect(secondResponse.status).toBe(200);

    const secondPage = (await secondResponse.json()) as {
      listings: Array<{ id: string; kind: string; status: string }>;
      pageInfo: { hasNextPage: boolean };
    };

    expect(secondPage.listings).toHaveLength(1);
    expect(secondPage.listings[0]?.id).not.toBe(firstPage.listings[0]?.id);
    expect(firstPage.listings[0]?.id).toBe(secondFoundListing.id);
    expect(secondPage.listings.map((listing) => listing.id)).toContain(firstFoundListing.id);
    expect(secondPage.pageInfo.hasNextPage).toBe(false);
    expect(firstFoundListing.id).not.toBe(lostListing.id);
  });

  test('rejects an invalid pagination cursor', async () => {
    const { cookie } = await registerUser();

    const response = await get('/listings?cursor=not-a-valid-cursor', cookie);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: 'INVALID_CURSOR',
        message: 'Invalid listing cursor',
      },
    });
  });
});

describe('GET /listings/:id', () => {
  test("allows an authenticated user to read another user's listing", async () => {
    const { cookie, user } = await registerUser();

    const [owner] = await db
      .insert(users)
      .values({
        email: 'owner@example.com',
        passwordHash: 'test-password-hash',
        displayName: 'Listing Owner',
      })
      .returning();

    if (!owner) {
      throw new Error('Failed to create listing owner');
    }

    const listing = await createListing({
      createdByUserId: owner.id,
      kind: 'lost',
      title: 'Black backpack',
      description: 'Black backpack with a laptop sleeve.',
      location: 'TU Berlin',
      occurredOn: '2026-09-01',
    });

    const response = await get(`/listings/${listing.id}`, cookie);

    expect(response.status).toBe(200);

    const body = (await response.json()) as ListingResponse;

    expect(body).toMatchObject({
      listing: {
        id: listing.id,
        kind: 'lost',
        status: 'active',
        title: 'Black backpack',
        description: 'Black backpack with a laptop sleeve.',
        location: 'TU Berlin',
        occurredOn: '2026-09-01',
      },
    });
    expect(body.listing).not.toHaveProperty('createdByUserId');

    expect(owner.id).not.toBe(user.id);
  });

  test('returns 404 when the listing does not exist', async () => {
    const { cookie } = await registerUser();

    const response = await get('/listings/00000000-0000-4000-8000-000000000000', cookie);

    expect(response.status).toBe(404);

    expect(await response.json()).toEqual({
      error: {
        code: 'LISTING_NOT_FOUND',
        message: 'Listing not found',
      },
    });
  });

  test('rejects an invalid listing id', async () => {
    const { cookie } = await registerUser();

    const response = await get('/listings/not-a-uuid', cookie);

    expect(response.status).toBe(422);
  });

  test('rejects a request without authentication', async () => {
    const response = await get('/listings/00000000-0000-4000-8000-000000000000');

    expect(response.status).toBe(401);

    expect(await response.json()).toEqual({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });
  });
});
