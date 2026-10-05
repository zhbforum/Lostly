import { t, ValidationError } from 'elysia';
import {
  CONVERSATION_CONSTRAINTS,
  CONVERSATION_IMAGE_CONSTRAINTS,
  CONVERSATION_MESSAGE_PAGINATION,
} from '@lostly/contracts/conversations';
import { CLAIM_STATUSES } from '@lostly/contracts/claims';
import { LISTING_KINDS, LISTING_STATUSES } from '@lostly/contracts/listings';
import { listingImageSchema } from '@/listing-images/model';
import { pageInfoSchema } from '@/pagination/model';

const idSchema = t.String({ format: 'uuid' });
const countSchema = t.Integer({ minimum: 0 });
const participantSchema = t.Object({ id: idSchema, displayName: t.String() });
const claimSummarySchema = t.Object({ id: idSchema, status: t.UnionEnum(CLAIM_STATUSES) });
const listingSummarySchema = t.Object({
  id: idSchema,
  kind: t.UnionEnum(LISTING_KINDS),
  status: t.UnionEnum(LISTING_STATUSES),
  title: t.String(),
  coverImage: t.Nullable(listingImageSchema),
});
const messagePreviewSchema = t.Object({
  id: idSchema,
  sequence: t.Integer({ minimum: 1 }),
  senderUserId: idSchema,
  body: t.Nullable(t.String()),
  attachmentCount: t.Integer({ minimum: 0, maximum: CONVERSATION_IMAGE_CONSTRAINTS.maxCount }),
  createdAt: t.Date(),
});
const messageAttachmentSchema = t.Object({
  id: idSchema,
  kind: t.Literal('image'),
  position: t.Integer({ minimum: 0, maximum: CONVERSATION_IMAGE_CONSTRAINTS.maxCount - 1 }),
  url: t.String(),
  urlExpiresAt: t.String({ format: 'date-time' }),
  width: t.Integer({ minimum: 1 }),
  height: t.Integer({ minimum: 1 }),
});
const messageSchema = t.Object({
  id: idSchema,
  conversationId: idSchema,
  sequence: t.Integer({ minimum: 1 }),
  senderUserId: idSchema,
  body: t.Nullable(t.String()),
  attachments: t.Array(messageAttachmentSchema, {
    maxItems: CONVERSATION_IMAGE_CONSTRAINTS.maxCount,
  }),
  createdAt: t.Date(),
});

export const conversationParamsSchema = t.Object({ conversationId: idSchema });
export const conversationInboxResponseSchema = t.Object({
  conversations: t.Array(
    t.Object({
      id: idSchema,
      claim: claimSummarySchema,
      listing: listingSummarySchema,
      otherParticipant: participantSchema,
      lastMessage: t.Nullable(messagePreviewSchema),
      lastActivityAt: t.Date(),
      unreadCount: countSchema,
      canSendMessages: t.Boolean(),
    }),
  ),
  pageInfo: pageInfoSchema,
});
export const conversationResponseSchema = t.Object({
  conversation: t.Object({
    id: idSchema,
    claim: t.Object({
      ...claimSummarySchema.properties,
      verificationDetails: t.String(),
      handoverDetails: t.Nullable(t.String()),
      createdAt: t.Date(),
      reviewedAt: t.Nullable(t.Date()),
    }),
    listing: t.Object({
      ...listingSummarySchema.properties,
      location: t.String(),
      occurredOn: t.String({ format: 'date' }),
    }),
    otherParticipant: participantSchema,
    participantRole: t.UnionEnum(['claimant', 'owner']),
    unreadCount: countSchema,
    canSendMessages: t.Boolean(),
  }),
});
export const conversationMessagesQuerySchema = t.Object({
  before: t.Optional(
    t.Numeric({
      minimum: 1,
      maximum: 2147483647,
      multipleOf: 1,
      description: 'Exclusive sequence boundary for older messages. Cannot be combined with after.',
    }),
  ),
  after: t.Optional(
    t.Numeric({
      minimum: 0,
      maximum: 2147483647,
      multipleOf: 1,
      description: 'Exclusive sequence boundary for catch-up. Zero starts from the first message.',
    }),
  ),
  limit: t.Optional(
    t.Numeric({
      minimum: 1,
      maximum: CONVERSATION_MESSAGE_PAGINATION.maxLimit,
      multipleOf: 1,
      description: `Page size; defaults to ${CONVERSATION_MESSAGE_PAGINATION.defaultLimit}.`,
    }),
  ),
});
export const conversationMessagesResponseSchema = t.Object({
  messages: t.Array(messageSchema),
  pageInfo: t.Object({ hasMore: t.Boolean() }),
});
export const sendMessageHeadersSchema = t.Object({ 'idempotency-key': idSchema });
export const sendMessageBodySchema = t.Object(
  {
    body: t.String({
      maxLength: CONVERSATION_CONSTRAINTS.messageMaxLength * 4,
      description:
        'Plain text. After trimming and line-ending normalization: 1–2000 Unicode code points. No HTML or Markdown interpretation.',
    }),
  },
  { additionalProperties: false },
);
export const sendMessageResponseSchema = t.Object({ message: messageSchema });
export const readConversationBodySchema = t.Object(
  { messageId: idSchema },
  { additionalProperties: false },
);
export const readConversationResponseSchema = t.Object({
  lastReadSequence: countSchema,
  unreadCount: countSchema,
});
export const unreadConversationsResponseSchema = t.Object({ unreadConversationCount: countSchema });
export const conversationErrorSchema = t.Object({
  error: t.Object({ code: t.String(), message: t.String() }),
});
export const conversationRateLimitSchema = t.Object(conversationErrorSchema.properties, {
  description: 'New-send attempt budget exhausted. Persisted matching retries remain available.',
  headers: {
    'Retry-After': t.Integer({
      minimum: 1,
      description: 'Seconds until a new send can be retried.',
    }),
  },
});

export function validateConversationBody(
  body: unknown,
  schema: typeof sendMessageBodySchema | typeof readConversationBodySchema,
) {
  if (
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    Object.keys(body).some((key) => !Object.hasOwn(schema.properties, key))
  ) {
    throw new ValidationError('body', schema, body);
  }
}
