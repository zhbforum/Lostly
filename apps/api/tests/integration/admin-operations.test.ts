import { afterAll, beforeEach, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  claims,
  listings,
  moderationCases,
  moderationEvents,
  moderationNotifications,
  sessions,
  users,
} from '@/db/schema';
import { claimConversations, claimMessages } from '@/db/conversations';
import { listingImages } from '@/db/listing-images';
import { hashPassword } from '@/auth/password';
import { createApp } from '@/app';
import { clearDatabase, claim, report, request, user } from './listings/management-fixtures';
import type {
  ModerationCase,
  ModerationNotification,
  ModerationPage,
} from '@lostly/contracts/moderation';
import type { AuthResponse } from '@lostly/contracts/auth';
import type { AdminAuditEvent, AdminListingDetail } from '@lostly/contracts/admin-operations';
import type {
  ConversationMessagesResponse,
  ConversationResponse,
  ClaimMessageResponse,
} from '@lostly/contracts/conversations';
import type { ListingDetailResponse } from '@lostly/contracts/listings';

async function clear() {
  await db.delete(moderationCases);
  await db.delete(moderationEvents);
  await clearDatabase();
}
beforeEach(clear);
afterAll(clear);
async function admin(name = 'admin') {
  const actor = await user(name);
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, actor.id));
  return actor;
}
async function createCase(cookie: string, targetId: string, targetType = 'listing') {
  const response = await request('/reports', cookie, {
    targetType,
    targetId,
    category: 'other',
    description: 'Please review this reported content.',
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { case: ModerationCase }).case;
}
const reason = 'Internal investigation detail';

test('requires admin sessions and CSRF on all operational surfaces', async () => {
  const member = await user('member');
  const actor = await admin();
  const id = Bun.randomUUIDv7();
  for (const path of [
    '/admin/operations',
    '/admin/administrators',
    '/admin/audit',
    '/admin/cases',
    '/admin/cases/' + id,
    '/admin/users/' + member.id,
    '/admin/listings/' + id,
    '/admin/claims/' + id,
  ]) {
    expect((await request(path)).status).toBe(401);
    expect((await request(path, member.cookie)).status).toBe(403);
  }
  const app = createApp();
  for (const path of [
    '/reports',
    '/admin/cases/' + id + '/evidence',
    '/admin/users/' + member.id + '/restriction',
    '/me/moderation/appeals',
  ]) {
    expect(
      (
        await app.handle(
          new Request('http://localhost' + path, {
            method: 'POST',
            headers: { cookie: actor.cookie, 'Content-Type': 'application/json' },
            body: '{}',
          }),
        )
      ).status,
    ).toBe(403);
  }
});

test('report -> assignment -> private notes -> public decision -> appeal keeps internal data private', async () => {
  const actor = await admin();
  const other = await admin('other-admin');
  const owner = await user('owner');
  const reporter = await user('reporter');
  const listing = await report(owner.id);
  const record = await createCase(reporter.cookie, listing.id);
  expect(
    (
      await request('/reports', reporter.cookie, {
        targetType: 'listing',
        targetId: listing.id,
        category: 'other',
        description: 'Duplicate report text.',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request('/admin/cases/' + record.id + '/assign', actor.cookie, {
        reason,
        expectedVersion: 1,
        assigneeId: actor.id,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request('/admin/cases/' + record.id + '/assign', other.cookie, {
        reason,
        expectedVersion: 1,
        assigneeId: other.id,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request('/admin/cases/' + record.id + '/notes', other.cookie, {
        body: 'Private note text',
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request('/admin/cases/' + record.id + '/notes', actor.cookie, {
        body: 'Private note text',
      })
    ).status,
  ).toBe(200);
  const details = await (await request('/admin/cases/' + record.id, actor.cookie)).text();
  expect(details).not.toContain('objectKey');
  expect(details).not.toContain('Original description');
  expect(
    (
      await request('/admin/listings/' + listing.id + '/hide', actor.cookie, {
        reason,
        publicReason: 'This report violates our content rules.',
        expectedVersion: 1,
        caseId: record.id,
      })
    ).status,
  ).toBe(204);
  const notices = (await (await request('/me/moderation/notifications', owner.cookie)).json()) as {
    notifications: ModerationPage<ModerationNotification>;
  };
  expect(JSON.stringify(notices)).not.toContain(reason);
  expect(notices.notifications.items[0]!.message).toBe('This report violates our content rules.');
  const eventId = notices.notifications.items[0]!.eventId;
  expect(
    (
      await request('/me/moderation/appeals', reporter.cookie, {
        eventId,
        description: 'This should not be accessible to me.',
      })
    ).status,
  ).toBe(404);
  const appeal = await request('/me/moderation/appeals', owner.cookie, {
    eventId,
    description: 'Please review this moderation decision.',
  });
  expect(appeal.status).toBe(200);
  expect(
    (
      await request('/me/moderation/appeals', owner.cookie, {
        eventId,
        description: 'Please review this moderation decision.',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request('/admin/cases/' + record.id + '/decision', actor.cookie, {
        reason,
        expectedVersion: 2,
        status: 'resolved',
        publicResolution: 'We reviewed your report and took action.',
      })
    ).status,
  ).toBe(200);
  const own = await (await request('/me/moderation/cases', reporter.cookie)).text();
  expect(own).toContain('We reviewed your report');
  expect(own).not.toMatch(/Private note text|Internal investigation detail|evidence|objectKey/);
  expect(
    (
      await request('/admin/cases/' + record.id + '/notes', actor.cookie, {
        body: 'Too late for a new note',
      })
    ).status,
  ).toBe(409);
  const audit = (await (
    await request('/admin/audit?caseId=' + record.id, actor.cookie)
  ).json()) as ModerationPage<AdminAuditEvent>;
  expect(audit.items.map((item) => item.action)).toContain('hide_listing');
  expect((await request('/admin/cases?unassigned=true', actor.cookie)).status).toBe(200);
});

test('restrictions revoke sessions but allow a fresh limited login, own decisions and appeals', async () => {
  const actor = await admin();
  const member = await user('member');
  const password = 'Correct horse battery staple 42';
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, member.id));
  expect(
    (
      await request('/admin/users/' + member.id + '/restriction', actor.cookie, {
        reason,
        publicReason: 'Repeated harassment.',
        expectedVersion: 1,
        permanent: true,
      })
    ).status,
  ).toBe(200);
  expect(await db.select().from(sessions).where(eq(sessions.userId, member.id))).toHaveLength(0);
  expect((await request('/auth/me', member.cookie)).status).toBe(401);
  const login = await request('/auth/login', undefined, { email: 'member@example.com', password });
  expect(login.status).toBe(200);
  expect(((await login.json()) as AuthResponse).user.restriction!.reason).toBe(
    'Repeated harassment.',
  );
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  expect((await request('/auth/me', cookie)).status).toBe(200);
  expect((await request('/listings', cookie)).status).toBe(403);
  const notices = (await (await request('/me/moderation/notifications', cookie)).json()) as {
    notifications: ModerationPage<ModerationNotification>;
  };
  expect(
    (
      await request('/me/moderation/appeals', cookie, {
        eventId: notices.notifications.items[0]!.eventId,
        description: 'Please reconsider this account restriction.',
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request('/reports', cookie, {
        targetType: 'user',
        targetId: actor.id,
        category: 'other',
        description: 'This account cannot create reports.',
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request('/admin/users/' + actor.id + '/restriction', actor.cookie, {
        reason,
        expectedVersion: 1,
        permanent: true,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request('/admin/users/' + member.id + '/restriction', actor.cookie, {
        reason,
        expectedVersion: 1,
        permanent: false,
        remove: true,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request('/admin/users/' + member.id + '/restriction', actor.cookie, {
        reason,
        expectedVersion: 2,
        permanent: false,
        remove: true,
      })
    ).status,
  ).toBe(200);
  expect((await request('/listings', cookie)).status).toBe(200);
});

test('message evidence and moderation stay case-scoped and preserve idempotent replay privacy', async () => {
  const actor = await admin();
  const owner = await user('owner');
  const claimant = await user('claimant');
  const stranger = await user('stranger');
  const listing = await report(owner.id);
  const pending = await claim(listing.id, claimant.id);
  const [conversation] = await db
    .select()
    .from(claimConversations)
    .where(eq(claimConversations.claimId, pending.id));
  const operation = Bun.randomUUIDv7();
  const [message] = await db
    .insert(claimMessages)
    .values({
      conversationId: conversation!.id,
      sequence: 1,
      senderUserId: claimant.id,
      clientOperationId: operation,
      body: 'Private message body',
    })
    .returning();
  expect((await request('/conversations/' + conversation!.id, actor.cookie)).status).toBe(404);
  expect(
    (
      await request('/reports', stranger.cookie, {
        targetType: 'message',
        targetId: message!.id,
        category: 'other',
        description: 'Cannot access private message.',
      })
    ).status,
  ).toBe(404);
  const record = await createCase(owner.cookie, message!.id, 'message');
  const details = await (await request('/admin/cases/' + record.id, actor.cookie)).text();
  expect(details).not.toContain('Private message body');
  const evidence = await request('/admin/cases/' + record.id + '/evidence', actor.cookie, {
    reason,
  });
  expect(evidence.status).toBe(200);
  expect(await evidence.text()).toContain('Private message body');
  expect(
    await db
      .select()
      .from(moderationEvents)
      .where(eq(moderationEvents.action, 'view_case_evidence')),
  ).toHaveLength(1);
  const unrelated = await createCase(owner.cookie, listing.id);
  expect(
    (
      await request('/admin/messages/' + message!.id + '/visibility', actor.cookie, {
        reason,
        caseId: unrelated.id,
        hidden: true,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request('/admin/messages/' + message!.id + '/visibility', actor.cookie, {
        reason,
        caseId: record.id,
        hidden: true,
      })
    ).status,
  ).toBe(200);
  const page = (await (
    await request('/conversations/' + conversation!.id + '/messages', owner.cookie)
  ).json()) as ConversationMessagesResponse;
  expect(page.messages[0]).toMatchObject({ body: null, isHidden: true, attachments: [] });
  expect(
    (
      (await (
        await request('/conversations/' + conversation!.id, owner.cookie)
      ).json()) as ConversationResponse
    ).conversation.contentVersion,
  ).toBe(2);
  const app = createApp();
  const replay = await app.handle(
    new Request('http://localhost/conversations/' + conversation!.id + '/messages', {
      method: 'POST',
      headers: {
        cookie: claimant.cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Protection': '1',
        'Idempotency-Key': operation,
      },
      body: JSON.stringify({ body: 'Private message body' }),
    }),
  );
  expect(replay.status).toBe(200);
  expect(((await replay.json()) as ClaimMessageResponse).message).toMatchObject({
    body: null,
    isHidden: true,
    attachments: [],
  });
  expect(
    (
      await request('/admin/cases/' + record.id + '/conversation', actor.cookie, {
        reason,
        closed: true,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      (await (
        await request('/conversations/' + conversation!.id, owner.cookie)
      ).json()) as ConversationResponse
    ).conversation.canSendMessages,
  ).toBe(false);
});

test('archive writes child audit events and an appeal reverses only its own closed claims', async () => {
  const actor = await admin();
  const owner = await user('owner');
  const claimant = await user('claimant');
  const listing = await report(owner.id);
  const pending = await claim(listing.id, claimant.id);
  expect(
    (
      await request('/admin/listings/' + listing.id + '/archive', actor.cookie, {
        reason,
        expectedVersion: 1,
      })
    ).status,
  ).toBe(204);
  const [child] = await db
    .select()
    .from(moderationEvents)
    .where(
      and(eq(moderationEvents.targetId, pending.id), eq(moderationEvents.action, 'reject_claim')),
    );
  expect(child!.parentEventId).not.toBeNull();
  const [notification] = await db
    .select()
    .from(moderationNotifications)
    .where(
      and(
        eq(moderationNotifications.userId, claimant.id),
        eq(moderationNotifications.eventId, child!.id),
      ),
    );
  const appeal = (await (
    await request('/me/moderation/appeals', claimant.cookie, {
      eventId: notification!.eventId,
      description: 'The report was archived by mistake.',
    })
  ).json()) as { case: ModerationCase };
  expect(
    (
      await request('/admin/cases/' + appeal.case.id + '/reverse-decision', actor.cookie, {
        reason,
        expectedVersion: 2,
      })
    ).status,
  ).toBe(200);
  expect((await db.select().from(listings))[0]!.status).toBe('active');
  expect((await db.select().from(claims))[0]!.status).toBe('pending');
  expect(
    (
      await request('/admin/cases/' + appeal.case.id + '/reverse-decision', actor.cookie, {
        reason,
        expectedVersion: 3,
      })
    ).status,
  ).toBe(409);
});

test('persistent report admission deduplicates concurrent reports and limits distinct targets', async () => {
  const member = await user('member');
  const owner = await user('owner');
  const listing = await report(owner.id);
  const submit = (id: string) =>
    request('/reports', member.cookie, {
      targetType: 'listing',
      targetId: id,
      category: 'other',
      description: 'Please review this report carefully.',
    });
  const duplicate = await Promise.all([submit(listing.id), submit(listing.id)]);
  expect(duplicate.map((r) => r.status).sort()).toEqual([200, 409]);
  const targets = await Promise.all(Array.from({ length: 6 }, () => report(owner.id)));
  const admitted = await Promise.all(targets.map((target) => submit(target.id)));
  expect(admitted.filter((r) => r.status === 200)).toHaveLength(4);
  expect(admitted.filter((r) => r.status === 429)).toHaveLength(2);
});

test('hidden photos never issue ordinary URLs while privileged review can restore them', async () => {
  const actor = await admin();
  const owner = await user('owner');
  const listing = await report(owner.id);
  const [image] = await db
    .insert(listingImages)
    .values({
      listingId: listing.id,
      objectKey: 'case-test/photo.webp',
      contentType: 'image/webp',
      sizeBytes: 100,
      width: 20,
      height: 20,
      position: 0,
    })
    .returning();
  expect(
    (
      await request('/admin/images/' + image!.id + '/visibility', actor.cookie, {
        reason,
        expectedVersion: 1,
        hidden: true,
      })
    ).status,
  ).toBe(200);
  const signed: string[] = [];
  const app = createApp({
    put: async () => {},
    delete: async () => {},
    createReadUrl: (key) => {
      signed.push(key);
      return {
        url: 'https://example.test/' + key,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
    },
  });
  const response = await app.handle(
    new Request('http://localhost/listings/' + listing.id, { headers: { cookie: owner.cookie } }),
  );
  expect(response.status).toBe(200);
  expect(((await response.json()) as ListingDetailResponse).images).toEqual([]);
  expect(signed).toEqual([]);
  const review = await app.handle(
    new Request('http://localhost/admin/listings/' + listing.id, {
      headers: { cookie: actor.cookie },
    }),
  );
  expect(review.status).toBe(200);
  expect(((await review.json()) as AdminListingDetail).images[0]!.isHidden).toBe(true);
  expect(signed).toEqual(['case-test/photo.webp']);
  expect(
    (
      await request('/admin/images/' + image!.id + '/visibility', actor.cookie, {
        reason,
        expectedVersion: 2,
        hidden: false,
      })
    ).status,
  ).toBe(200);
});
