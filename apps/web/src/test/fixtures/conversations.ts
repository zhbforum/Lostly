import type {
  ClaimMessage,
  ConversationDetail,
  ConversationInboxResponse,
  ConversationMessagesResponse,
  ConversationSummary,
} from '@/features/conversations/model/types';

export function message(sequence: number, overrides: Partial<ClaimMessage> = {}): ClaimMessage {
  return {
    id: `message-${sequence}`,
    conversationId: 'A',
    sequence,
    senderUserId: 'other-user',
    body: `Message ${sequence}`,
    createdAt: '2026-09-24T12:00:00.000Z',
    ...overrides,
  };
}

export function conversation(
  id = 'A',
  overrides: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    id,
    claim: { id: `claim-${id}`, status: 'pending' },
    listing: {
      id: 'listing-1',
      kind: 'found',
      status: 'active',
      title: 'AirPods Pro',
      coverImage: null,
    },
    otherParticipant: { id: 'other-user', displayName: 'Alex' },
    lastMessage: null,
    lastActivityAt: '2026-09-24T12:00:00.000Z',
    unreadCount: 0,
    canSendMessages: true,
    ...overrides,
  };
}

export function conversationDetail(
  overrides: Partial<ConversationDetail> = {},
): ConversationDetail {
  const summary = conversation();
  return {
    id: summary.id,
    otherParticipant: summary.otherParticipant,
    listing: { ...summary.listing, location: 'Central Station', occurredOn: '2026-09-24' },
    claim: {
      ...summary.claim,
      verificationDetails: 'My private proof',
      handoverDetails: null,
      createdAt: summary.lastActivityAt,
      reviewedAt: null,
    },
    participantRole: 'claimant',
    unreadCount: 0,
    canSendMessages: true,
    ...overrides,
  };
}

export function inboxPage(
  conversations: ConversationSummary[],
  cursor: string | null = null,
): ConversationInboxResponse {
  return { conversations, pageInfo: { endCursor: cursor, hasNextPage: cursor !== null } };
}

export function historyPage(
  messages: ClaimMessage[],
  hasMore = false,
): ConversationMessagesResponse {
  return { messages, pageInfo: { hasMore } };
}
