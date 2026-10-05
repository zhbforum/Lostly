import type { Claim } from './claims';
import type { Listing, ListingImage } from './listings';
import type { PageInfo, PageQuery } from './pagination';

export const CONVERSATION_CONSTRAINTS = {
  messageMinLength: 1,
  messageMaxLength: 2000,
} as const;

export const CONVERSATION_IMAGE_CONSTRAINTS = {
  maxCount: 4,
  maxSizeBytes: 5 * 1024 * 1024,
  allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
} as const;

export const CONVERSATION_MESSAGE_PAGINATION = {
  defaultLimit: 50,
  maxLimit: 100,
} as const;

export type ConversationInboxQuery = PageQuery;

export interface ConversationMessagesQuery {
  before?: number;
  after?: number;
  limit?: number;
}

export interface ConversationParticipant {
  id: string;
  displayName: string;
}

export interface ConversationSummary {
  id: string;
  claim: Pick<Claim, 'id' | 'status'>;
  listing: Pick<Listing, 'id' | 'kind' | 'status' | 'title'> & {
    coverImage: ListingImage | null;
  };
  otherParticipant: ConversationParticipant;
  lastMessage: ClaimMessagePreview | null;
  lastActivityAt: string;
  unreadCount: number;
  canSendMessages: boolean;
}

export interface ConversationDetail {
  id: string;
  claim: Pick<
    Claim,
    'id' | 'status' | 'verificationDetails' | 'handoverDetails' | 'createdAt' | 'reviewedAt'
  >;
  listing: Pick<Listing, 'id' | 'kind' | 'status' | 'title' | 'location' | 'occurredOn'> & {
    coverImage: ListingImage | null;
  };
  otherParticipant: ConversationParticipant;
  participantRole: 'claimant' | 'owner';
  unreadCount: number;
  canSendMessages: boolean;
}

export interface ClaimMessageAttachment {
  id: string;
  kind: 'image';
  position: number;
  url: string;
  urlExpiresAt: string;
  width: number;
  height: number;
}

export interface ClaimMessagePreview {
  id: string;
  sequence: number;
  senderUserId: string;
  body: string | null;
  attachmentCount: number;
  createdAt: string;
}

export interface ClaimMessage {
  id: string;
  conversationId: string;
  sequence: number;
  senderUserId: string;
  body: string | null;
  attachments: ClaimMessageAttachment[];
  createdAt: string;
}

export interface SendClaimMessageInput {
  body: string;
}

export interface ReadConversationInput {
  messageId: string;
}

export interface ConversationInboxResponse {
  conversations: ConversationSummary[];
  pageInfo: PageInfo;
}

export interface ConversationResponse {
  conversation: ConversationDetail;
}

export interface ConversationMessagesResponse {
  messages: ClaimMessage[];
  pageInfo: { hasMore: boolean };
}

export interface ClaimMessageResponse {
  message: ClaimMessage;
}

export interface ReadConversationResponse {
  lastReadSequence: number;
  unreadCount: number;
}

export interface UnreadConversationsResponse {
  unreadConversationCount: number;
}
