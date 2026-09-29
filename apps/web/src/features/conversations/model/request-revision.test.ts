import { expect, it } from 'vitest';
import { advanceSessionGeneration } from '@/shared/api/session-events';
import { deferred } from '@/test/deferred';
import { conversation, conversationDetail, inboxPage } from '@/test/fixtures/conversations';
import { applyInboxRead, emptyInbox, mergeInboxPage } from './inbox-merge';
import { createRequestRevision } from './request-revision';

it('does not resurrect unread counts when old inbox/context/global requests resolve after a read', async () => {
  const guards = [createRequestRevision(), createRequestRevision(), createRequestRevision()];
  const tokens = guards.map((guard) => guard.capture());
  const oldResponses = [deferred<number>(), deferred<number>(), deferred<number>()];
  let inbox = mergeInboxPage(
    emptyInbox(),
    inboxPage([conversation('A', { unreadCount: 4 })]),
    'initial',
  );
  let context = conversationDetail({ unreadCount: 4 });
  let globalUnread = 1;
  const pending = oldResponses.map((response, i) =>
    response.promise.then((count) => {
      if (!guards[i].isCurrent(tokens[i])) return;
      if (i === 0)
        inbox = mergeInboxPage(
          inbox,
          inboxPage([conversation('A', { unreadCount: count })]),
          'refresh',
        );
      if (i === 1) context = { ...context, unreadCount: count };
      if (i === 2) globalUnread = count;
    }),
  );

  // A successful read invalidates all requests begun before its authoritative result.
  guards.forEach((guard) => guard.invalidate());
  inbox = applyInboxRead(inbox, 'A', 0);
  context = { ...context, unreadCount: 0 };
  const refreshedUnread = guards[2].capture();
  if (guards[2].isCurrent(refreshedUnread)) globalUnread = 0;
  oldResponses.forEach((response) => response.resolve(4));
  await Promise.all(pending);
  expect([inbox.byId.A.unreadCount, context.unreadCount, globalUnread]).toEqual([0, 0, 0]);
});

it('isolates A from B, disposed controllers and previous sessions', () => {
  const a = createRequestRevision();
  const b = createRequestRevision();
  const tokenA = a.capture();
  const tokenB = b.capture();
  expect(b.isCurrent(tokenA)).toBe(false);
  a.dispose();
  expect(a.isCurrent(tokenA)).toBe(false);
  expect(b.isCurrent(tokenB)).toBe(true);
  advanceSessionGeneration();
  expect(b.isCurrent(tokenB)).toBe(false);
  expect(b.isCurrent(b.capture())).toBe(true);
});
