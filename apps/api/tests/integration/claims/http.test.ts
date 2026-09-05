import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { app } from '@/app';
import { db } from '@/db';
import { claims, listings, users } from '@/db/schema';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from '@/http/csrf';
import { createListing } from '@/listings/service';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl?.endsWith('/lostly_test')) {
  throw new Error('Integration tests require the lostly_test database');
}

const PASSWORD = 'correct horse battery staple';

interface UserSession {
  id: string;
  displayName: string;
  cookie: string;
}

async function clearDatabase() {
  await db.delete(claims);
  await db.delete(listings);
  await db.delete(users);
}

beforeEach(clearDatabase);
afterAll(clearDatabase);

function request(path: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown, cookie?: string) {
  const headers = new Headers();

  if (cookie) {
    headers.set('cookie', cookie);
  }

  if (body !== undefined) {
    headers.set('content-type', 'application/json');
  }

  if (method !== 'GET') {
    headers.set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);
  }

  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function registerUser(email: string, displayName: string): Promise<UserSession> {
  const response = await request('/auth/register', 'POST', {
    email,
    password: PASSWORD,
    displayName,
  });

  if (response.status !== 201) {
    throw new Error(`Failed to register ${email}`);
  }

  const body = (await response.json()) as {
    user: { id: string; displayName: string };
  };
  const setCookie = response.headers.get('set-cookie');
  const cookie = setCookie?.split(';')[0];

  if (!cookie) {
    throw new Error('Expected session cookie');
  }

  return { ...body.user, cookie };
}

describe('claims HTTP flow', () => {
  test('keeps verification details private while allowing the report owner to review them', async () => {
    const owner = await registerUser('owner@example.com', 'Finder');
    const claimant = await registerUser('claimant@example.com', 'Owner');
    const bystander = await registerUser('bystander@example.com', 'Bystander');
    const listing = await createListing({
      createdByUserId: owner.id,
      kind: 'found',
      title: 'Blue backpack',
      description: 'A backpack was found near the library.',
      location: 'TU Berlin library',
      occurredOn: '2026-09-01',
    });

    const createResponse = await request(
      `/listings/${listing.id}/claims`,
      'POST',
      { verificationDetails: 'My initials are sewn inside the front pocket.' },
      claimant.cookie,
    );

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      claim: { id: string; status: string; verificationDetails: string };
    };
    expect(created.claim).toMatchObject({
      status: 'pending',
      verificationDetails: 'My initials are sewn inside the front pocket.',
    });

    const listingResponse = await request(
      `/listings/${listing.id}`,
      'GET',
      undefined,
      bystander.cookie,
    );
    expect(listingResponse.status).toBe(200);
    expect(JSON.stringify(await listingResponse.json())).not.toContain('initials are sewn');

    const forbiddenResponse = await request(
      `/listings/${listing.id}/claims`,
      'GET',
      undefined,
      bystander.cookie,
    );
    expect(forbiddenResponse.status).toBe(403);

    const incomingResponse = await request(
      `/listings/${listing.id}/claims`,
      'GET',
      undefined,
      owner.cookie,
    );
    expect(incomingResponse.status).toBe(200);
    expect(await incomingResponse.json()).toMatchObject({
      claims: [
        {
          id: created.claim.id,
          verificationDetails: 'My initials are sewn inside the front pocket.',
          claimant: { id: claimant.id, displayName: claimant.displayName },
        },
      ],
    });
  });

  test('only permits a found listing owner to approve a pending claim and resolves the listing', async () => {
    const owner = await registerUser('owner@example.com', 'Finder');
    const claimant = await registerUser('claimant@example.com', 'Owner');
    const secondClaimant = await registerUser('second@example.com', 'Second owner');
    const listing = await createListing({
      createdByUserId: owner.id,
      kind: 'found',
      title: 'Blue backpack',
      description: 'A backpack was found near the library.',
      location: 'TU Berlin library',
      occurredOn: '2026-09-01',
    });

    const firstClaimResponse = await request(
      `/listings/${listing.id}/claims`,
      'POST',
      { verificationDetails: 'My initials are sewn inside the front pocket.' },
      claimant.cookie,
    );
    const secondClaimResponse = await request(
      `/listings/${listing.id}/claims`,
      'POST',
      { verificationDetails: 'The front pocket contains a red pencil case.' },
      secondClaimant.cookie,
    );
    const firstClaim = (await firstClaimResponse.json()) as { claim: { id: string } };
    const secondClaim = (await secondClaimResponse.json()) as { claim: { id: string } };

    const forbiddenResponse = await request(
      `/claims/${firstClaim.claim.id}`,
      'PATCH',
      { decision: 'approved', handoverDetails: 'Collect from the library reception after 10am.' },
      claimant.cookie,
    );
    expect(forbiddenResponse.status).toBe(403);

    const decisionResponse = await request(
      `/claims/${firstClaim.claim.id}`,
      'PATCH',
      { decision: 'approved', handoverDetails: 'Collect from the library reception after 10am.' },
      owner.cookie,
    );
    expect(decisionResponse.status).toBe(200);
    expect(await decisionResponse.json()).toMatchObject({
      claim: { id: firstClaim.claim.id, status: 'approved' },
    });

    const [storedListing] = await db.select().from(listings).where(eq(listings.id, listing.id));
    const [storedSecondClaim] = await db
      .select()
      .from(claims)
      .where(eq(claims.id, secondClaim.claim.id));

    expect(storedListing?.status).toBe('resolved');
    expect(storedSecondClaim?.status).toBe('rejected');

    const repeatDecision = await request(
      `/claims/${firstClaim.claim.id}`,
      'PATCH',
      { decision: 'rejected' },
      owner.cookie,
    );
    expect(repeatDecision.status).toBe(409);
  });

  test('rejects claims for own, lost, or resolved listings', async () => {
    const owner = await registerUser('owner@example.com', 'Finder');
    const claimant = await registerUser('claimant@example.com', 'Owner');
    const foundListing = await createListing({
      createdByUserId: owner.id,
      kind: 'found',
      title: 'Blue backpack',
      description: 'A backpack was found near the library.',
      location: 'TU Berlin library',
      occurredOn: '2026-09-01',
    });
    const lostListing = await createListing({
      createdByUserId: owner.id,
      kind: 'lost',
      title: 'Black backpack',
      description: 'A backpack was lost near the library.',
      location: 'TU Berlin library',
      occurredOn: '2026-09-01',
    });

    const ownClaim = await request(
      `/listings/${foundListing.id}/claims`,
      'POST',
      { verificationDetails: 'My initials are sewn inside the front pocket.' },
      owner.cookie,
    );
    expect(ownClaim.status).toBe(403);

    const lostClaim = await request(
      `/listings/${lostListing.id}/claims`,
      'POST',
      { verificationDetails: 'My initials are sewn inside the front pocket.' },
      claimant.cookie,
    );
    expect(lostClaim.status).toBe(409);

    await db.update(listings).set({ status: 'resolved' }).where(eq(listings.id, foundListing.id));
    const resolvedClaim = await request(
      `/listings/${foundListing.id}/claims`,
      'POST',
      { verificationDetails: 'My initials are sewn inside the front pocket.' },
      claimant.cookie,
    );
    expect(resolvedClaim.status).toBe(409);
  });
});
