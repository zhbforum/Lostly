import { describe, expect, it } from 'vitest';
import { conversation, inboxPage } from '@/test/fixtures/conversations';
import {
  applyInboxDecision,
  applyInboxRead,
  emptyInbox,
  mergeInboxPage,
  removeInboxConversation,
  sortedInbox,
} from './inbox-merge';

describe('inbox live-list model', () => {
  it('appends and deduplicates while keeping the continuation cursor independent of refresh', () => {
    let state = mergeInboxPage(emptyInbox(), inboxPage([conversation('A')], 'page-2'), 'initial');

    state = mergeInboxPage(
      state,
      inboxPage([conversation('A'), conversation('B')], 'page-3'),
      'append',
    );
    state = mergeInboxPage(
      state,
      inboxPage([conversation('C'), conversation('A')], 'new-page-2'),
      'refresh',
    );

    expect(Object.keys(state.byId).sort()).toEqual(['A', 'B', 'C']);
    expect(state.loadMoreCursor).toBe('page-3');
    expect(state.hasMore).toBe(true);

    state = mergeInboxPage(state, inboxPage([conversation('D')]), 'append');
    state = mergeInboxPage(state, inboxPage([conversation('C')], 'new-page-2'), 'refresh');

    expect(state.loadMoreCursor).toBeNull();
    expect(state.hasMore).toBe(false);
  });

  it('rewinds pagination when a loaded boundary moves and can conceal unseen rows', () => {
    let state = mergeInboxPage(emptyInbox(), inboxPage([conversation('A')]), 'initial');

    state = mergeInboxPage(
      state,
      inboxPage([conversation('A', { lastActivityAt: '2026-09-25T12:00:00.000Z' })], 'new-tail'),
      'refresh',
    );

    expect(state.loadMoreCursor).toBe('new-tail');
    expect(state.hasMore).toBe(true);
  });

  it('reorders live activity, breaks ties by descending ID and replaces refreshed rows', () => {
    let state = mergeInboxPage(
      emptyInbox(),
      inboxPage([
        conversation('A'),
        conversation('B'),
        conversation('C', { lastActivityAt: '2026-09-23T12:00:00.000Z' }),
      ]),
      'initial',
    );

    expect(sortedInbox(state).map(({ id }) => id)).toEqual(['B', 'A', 'C']);

    state = mergeInboxPage(
      state,
      inboxPage([
        conversation('C', { lastActivityAt: '2026-09-25T12:00:00.000Z', unreadCount: 3 }),
      ]),
      'refresh',
    );

    expect(sortedInbox(state).map(({ id }) => id)).toEqual(['C', 'B', 'A']);
    expect(state.byId.C.unreadCount).toBe(3);
  });

  it('does not infer disappearance from an empty head page', () => {
    const state = mergeInboxPage(emptyInbox(), inboxPage([conversation()]), 'initial');
    const refreshed = mergeInboxPage(state, inboxPage([]), 'refresh');

    expect(refreshed.byId.A).toEqual(state.byId.A);
    expect(removeInboxConversation(refreshed, 'A').byId).toEqual({});
  });

  it('patches all loaded claims for an approved listing, including rows outside page one', () => {
    const otherListing = conversation('D', {
      listing: { ...conversation().listing, id: 'listing-2' },
    });
    const state = mergeInboxPage(
      emptyInbox(),
      inboxPage([
        conversation('A'),
        conversation('B'),
        conversation('C', { claim: { id: 'claim-C', status: 'rejected' }, canSendMessages: false }),
        otherListing,
      ]),
      'initial',
    );
    const approved = applyInboxDecision(state, 'listing-1', 'claim-A', 'approved');

    expect(approved.byId.A).toMatchObject({
      claim: { status: 'approved' },
      canSendMessages: true,
      listing: { status: 'resolved' },
    });
    expect(approved.byId.B).toMatchObject({
      claim: { status: 'rejected' },
      canSendMessages: false,
      listing: { status: 'resolved' },
    });
    expect(approved.byId.C.claim.status).toBe('rejected');
    expect(approved.byId.D).toBe(otherListing);
    expect(state.byId.A.claim.status).toBe('pending');
  });

  it('rejects only the chosen claim and applies the exact server unread count', () => {
    const state = mergeInboxPage(
      emptyInbox(),
      inboxPage([conversation('A', { unreadCount: 5 }), conversation('B')]),
      'initial',
    );
    const rejected = applyInboxDecision(state, 'listing-1', 'claim-A', 'rejected');

    expect(rejected.byId.A).toMatchObject({
      claim: { status: 'rejected' },
      canSendMessages: false,
    });
    expect(rejected.byId.B.claim.status).toBe('pending');
    expect(applyInboxRead(rejected, 'A', 2).byId.A.unreadCount).toBe(2);
    expect(applyInboxRead(rejected, 'missing', 0)).toBe(rejected);
  });
});
