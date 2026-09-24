import { afterAll, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type {
  ClaimActivityResponse,
  ClaimResponse,
  IncomingClaimsResponse,
} from '@lostly/contracts/claims';
import type { ListingDetailResponse } from '@lostly/contracts/listings';
import { db } from '@/db';
import { users } from '@/db/schema';
import { claimConversations } from '@/db/conversations';
import { sendClaimMessage } from '@/conversations/send';
import { findConversationForMember } from '@/conversations/authorization';
import { setListingVisibility } from '@/admin/service';
import { clearDatabase, report, request, user } from '../listings/management-fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

const privateMessage = 'Private chat content must not enter claim or admin responses.';

async function getJson<T>(path: string, cookie: string): Promise<T> {
  const response = await request(path, cookie);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain(privateMessage);
  expect(text).not.toMatch(/"messages"|"lastMessage"|"clientOperationId"/);
  return JSON.parse(text) as T;
}

async function fixture() {
  const owner = await user('owner');
  const claimant = await user('claimant');
  const listing = await report(owner.id);
  const created = await request(`/listings/${listing.id}/claims`, claimant.cookie, {
    verificationDetails: 'Private identifying details for the claim.',
  });
  expect(created.status).toBe(201);
  const { claim } = (await created.json()) as ClaimResponse;
  const [conversation] = await db
    .select()
    .from(claimConversations)
    .where(eq(claimConversations.claimId, claim.id));
  expect(claim.conversationId).toBe(conversation!.id);
  expect(
    await sendClaimMessage({
      conversationId: claim.conversationId,
      userId: claimant.id,
      clientOperationId: crypto.randomUUID(),
      body: privateMessage,
    }),
  ).toMatchObject({ ok: true });
  return { owner, claimant, listing, claim };
}

async function expectEntryPoints(
  state: Awaited<ReturnType<typeof fixture>>,
  status: 'pending' | 'approved' | 'rejected',
) {
  const { claim, listing, owner, claimant } = state;
  const expected = { id: claim.id, conversationId: claim.conversationId, status };
  const details = await getJson<ListingDetailResponse>(`/listings/${listing.id}`, claimant.cookie);
  expect(details.claim).toMatchObject(expected);
  expect(details.listing).not.toHaveProperty('conversationId');
  const incoming = await getJson<IncomingClaimsResponse>(
    `/listings/${listing.id}/claims`,
    owner.cookie,
  );
  expect(incoming.claims).toHaveLength(1);
  expect(incoming.claims[0]).toMatchObject(expected);
  for (const [cookie, direction] of [
    [claimant.cookie, 'outgoing'],
    [owner.cookie, 'incoming'],
  ] as const) {
    const activity = await getJson<ClaimActivityResponse>(
      `/me/claims?direction=${direction}`,
      cookie,
    );
    expect(activity.claims).toHaveLength(1);
    expect(activity.claims[0]).toMatchObject(expected);
    expect(activity.claims[0]).not.toHaveProperty('verificationDetails');
    expect(activity.claims[0]).not.toHaveProperty('handoverDetails');
  }
}

test.each(['approved', 'rejected'] as const)(
  'preserves the same conversation ID across creation, participant views and %s decision',
  async (decision) => {
    const state = await fixture();
    await expectEntryPoints(state, 'pending');
    const response = await request(
      `/claims/${state.claim.id}`,
      state.owner.cookie,
      decision === 'approved'
        ? { decision, handoverDetails: 'Meet at the library entrance.' }
        : { decision },
      'PATCH',
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(privateMessage);
    expect((JSON.parse(text) as ClaimResponse).claim).toMatchObject({
      id: state.claim.id,
      conversationId: state.claim.conversationId,
      status: decision,
    });
    await expectEntryPoints(state, decision);
    expect(
      await findConversationForMember(state.claim.conversationId, state.owner.id),
    ).toMatchObject({ claimId: state.claim.id, claimStatus: decision });
  },
);

test('keeps conversation IDs and chat content out of public listing and admin representations', async () => {
  const { owner, claimant, listing, claim } = await fixture();
  const stranger = await user('stranger');
  const admin = await user('admin');
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.id));
  for (const viewer of [stranger, admin]) {
    const details = await getJson<ListingDetailResponse>(`/listings/${listing.id}`, viewer.cookie);
    expect(details.claim).toBeNull();
    expect(JSON.stringify(details)).not.toContain(claim.conversationId);
    expect((await request(`/listings/${listing.id}/claims`, viewer.cookie)).status).toBe(403);
    for (const direction of ['incoming', 'outgoing']) {
      const activity = await getJson<ClaimActivityResponse>(
        `/me/claims?direction=${direction}`,
        viewer.cookie,
      );
      expect(activity.claims).toEqual([]);
    }
  }
  for (const viewer of [owner, claimant, stranger, admin]) {
    const feed = await getJson<unknown>('/listings', viewer.cookie);
    expect(JSON.stringify(feed)).not.toContain('conversationId');
  }
  for (const path of ['/admin/claims', '/admin/listings', `/admin/claims/${claim.id}/review`]) {
    const body = await getJson<unknown>(path, admin.cookie);
    expect(JSON.stringify(body)).not.toMatch(/conversationId|verificationDetails|handoverDetails/);
    expect(JSON.stringify(body)).not.toContain(claim.conversationId);
  }
});

test('hidden claims expose no entry IDs and restore returns their original conversation IDs', async () => {
  const state = await fixture();
  const admin = await user('admin');
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.id));
  expect(
    await setListingVisibility(state.listing.id, admin.id, 'hide', {
      expectedVersion: 1,
      reason: 'Hide for review',
    }),
  ).toBe('ok');
  for (const viewer of [state.owner, state.claimant]) {
    expect((await request(`/listings/${state.listing.id}`, viewer.cookie)).status).toBe(404);
    expect((await request(`/listings/${state.listing.id}/claims`, viewer.cookie)).status).toBe(404);
    for (const direction of ['incoming', 'outgoing']) {
      const activity = await getJson<ClaimActivityResponse>(
        `/me/claims?direction=${direction}`,
        viewer.cookie,
      );
      expect(activity.claims).toEqual([]);
    }
  }
  expect(
    (
      await request(
        `/claims/${state.claim.id}`,
        state.owner.cookie,
        { decision: 'rejected' },
        'PATCH',
      )
    ).status,
  ).toBe(404);
  expect(
    await setListingVisibility(state.listing.id, admin.id, 'restore', {
      expectedVersion: 2,
      reason: 'Restore after review',
    }),
  ).toBe('ok');
  await expectEntryPoints(state, 'pending');
});
