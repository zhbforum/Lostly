import type { ClaimDecision } from '@lostly/contracts/claims';
import type { ConversationInboxResponse, ConversationSummary } from './types';

export interface ConversationInboxState {
  byId: Readonly<Record<string, ConversationSummary>>;
  loadMoreCursor: string | null;
  hasMore: boolean;
}

export const emptyInbox = (): ConversationInboxState => ({
  byId: {},
  loadMoreCursor: null,
  hasMore: false,
});

export function mergeInboxPage(
  state: ConversationInboxState,
  page: ConversationInboxResponse,
  mode: 'initial' | 'refresh' | 'append',
): ConversationInboxState {
  const byId = { ...state.byId };
  for (const conversation of page.conversations) byId[conversation.id] = conversation;
  return {
    byId,
    loadMoreCursor: mode === 'refresh' ? state.loadMoreCursor : page.pageInfo.endCursor,
    hasMore: mode === 'refresh' ? state.hasMore : page.pageInfo.hasNextPage,
  };
}

export function sortedInbox(state: ConversationInboxState): ConversationSummary[] {
  return Object.values(state.byId).sort((a, b) => {
    if (a.lastActivityAt !== b.lastActivityAt) return a.lastActivityAt < b.lastActivityAt ? 1 : -1;
    return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
  });
}

export function applyInboxRead(
  state: ConversationInboxState,
  conversationId: string,
  unreadCount: number,
): ConversationInboxState {
  const conversation = state.byId[conversationId];
  return conversation
    ? { ...state, byId: { ...state.byId, [conversationId]: { ...conversation, unreadCount } } }
    : state;
}

export function removeInboxConversation(state: ConversationInboxState, conversationId: string) {
  const byId = { ...state.byId };
  delete byId[conversationId];
  return { ...state, byId };
}

export function applyInboxDecision(
  state: ConversationInboxState,
  listingId: string,
  claimId: string,
  decision: ClaimDecision,
): ConversationInboxState {
  const byId = { ...state.byId };
  for (const conversation of Object.values(byId)) {
    if (conversation.listing.id !== listingId) continue;
    const selected = conversation.claim.id === claimId;
    const rejectedByApproval =
      decision === 'approved' && !selected && conversation.claim.status === 'pending';
    byId[conversation.id] = {
      ...conversation,
      listing:
        decision === 'approved'
          ? { ...conversation.listing, status: 'resolved' }
          : conversation.listing,
      ...(selected || rejectedByApproval
        ? {
            claim: { ...conversation.claim, status: selected ? decision : 'rejected' },
            canSendMessages: selected && decision === 'approved',
          }
        : {}),
    };
  }
  return { ...state, byId };
}
