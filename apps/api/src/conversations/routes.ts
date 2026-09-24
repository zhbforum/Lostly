import { Elysia } from 'elysia';
import { authenticationPlugin } from '@/auth/plugin';
import { openApiMutationSecurity, openApiSessionSecurity } from '@/openapi';
import { pageQuerySchema } from '@/pagination/model';
import type { ObjectStorage } from '@/storage/object-storage';
import { CONVERSATION_ERRORS } from './errors';
import {
  conversationErrorSchema,
  conversationInboxResponseSchema,
  conversationMessagesQuerySchema,
  conversationMessagesResponseSchema,
  conversationParamsSchema,
  conversationRateLimitSchema,
  conversationResponseSchema,
  readConversationBodySchema,
  readConversationResponseSchema,
  sendMessageBodySchema,
  sendMessageHeadersSchema,
  sendMessageResponseSchema,
  unreadConversationsResponseSchema,
  validateConversationBody,
} from './model';
import {
  countUnreadConversations,
  findConversationDetail,
  findConversationMessages,
  listConversations,
} from './queries';
import { readConversation } from './read';
import { sendClaimMessage } from './send';

export const createConversationRoutes = (storage: ObjectStorage) =>
  new Elysia({ detail: { tags: ['Conversations'] } })
    .use(authenticationPlugin)
    .get(
      '/me/conversations',
      async ({ auth, query, status }) => {
        const result = await listConversations(auth.user.id, query, storage);
        if (!result.ok) {
          const { status: code, ...error } = CONVERSATION_ERRORS[result.reason];
          return status(code, { error });
        }
        return result.value;
      },
      {
        authenticated: true,
        query: pageQuerySchema,
        response: {
          200: conversationInboxResponseSchema,
          400: conversationErrorSchema,
          422: conversationErrorSchema,
        },
        detail: {
          summary: 'List my claim conversations',
          security: openApiSessionSecurity,
          description:
            'Live ordering by last message time, or conversation creation time when empty, then ID descending. Pagination does not provide a cross-request snapshot. Refresh page one and merge/dedupe by conversation ID. Cursors are scoped to the authenticated user. Does not mark messages read.',
        },
      },
    )
    .get('/me/conversations/unread-count', ({ auth }) => countUnreadConversations(auth.user.id), {
      authenticated: true,
      response: { 200: unreadConversationsResponseSchema },
      detail: {
        summary: 'Count unread conversations',
        security: openApiSessionSecurity,
        description:
          'Counts accessible conversations with at least one unread incoming message, not messages. Hidden listings are excluded; rejected conversations still count.',
      },
    })
    .get(
      '/conversations/:conversationId',
      async ({ auth, params, status }) => {
        const conversation = await findConversationDetail(
          params.conversationId,
          auth.user.id,
          storage,
        );
        if (!conversation) {
          const { status: code, ...error } = CONVERSATION_ERRORS['conversation-not-found'];
          return status(code, { error });
        }
        return { conversation };
      },
      {
        authenticated: true,
        params: conversationParamsSchema,
        response: {
          200: conversationResponseSchema,
          404: conversationErrorSchema,
          422: conversationErrorSchema,
        },
        detail: {
          summary: 'Get private conversation context',
          security: openApiSessionSecurity,
          description:
            'Participant-only claim proof, handover instructions, listing context and current capabilities. Nonparticipants (including admins) and hidden listings return 404. Poll independently of messages to detect lifecycle changes. Does not advance read state.',
        },
      },
    )
    .get(
      '/conversations/:conversationId/messages',
      async ({ auth, params, query, status }) => {
        const result = await findConversationMessages(params.conversationId, auth.user.id, query);
        if (!result.ok) {
          const { status: code, ...error } = CONVERSATION_ERRORS[result.reason];
          return status(code, { error });
        }
        return result.value;
      },
      {
        authenticated: true,
        params: conversationParamsSchema,
        query: conversationMessagesQuerySchema,
        response: {
          200: conversationMessagesResponseSchema,
          400: conversationErrorSchema,
          404: conversationErrorSchema,
          422: conversationErrorSchema,
        },
        detail: {
          summary: 'Get message history or catch up',
          security: openApiSessionSecurity,
          description:
            'Always returns ascending sequence order. Without a boundary: latest N messages. Before: nearest older N. After: first newer N; after=0 is valid. Before and after together return 400. hasMore refers to the requested direction. Continue after the last returned sequence until hasMore is false. GET never marks messages read. Nonparticipants and hidden listings return 404.',
        },
      },
    )
    .post(
      '/conversations/:conversationId/messages',
      async ({ auth, params, body, headers, status, set }) => {
        const result = await sendClaimMessage({
          conversationId: params.conversationId,
          userId: auth.user.id,
          clientOperationId: headers['idempotency-key'],
          body: body.body,
        });
        if (!result.ok) {
          if (result.reason === 'rate-limited')
            set.headers['Retry-After'] = String(result.retryAfterSeconds);
          const { status: code, ...error } = CONVERSATION_ERRORS[result.reason];
          return status(code, { error });
        }
        return status(result.value.created ? 201 : 200, { message: result.value.message });
      },
      {
        authenticated: true,
        params: conversationParamsSchema,
        headers: sendMessageHeadersSchema,
        parse: 'json',
        body: sendMessageBodySchema,
        transform({ body }) {
          validateConversationBody(body, sendMessageBodySchema);
        },
        response: {
          200: sendMessageResponseSchema,
          201: sendMessageResponseSchema,
          400: conversationErrorSchema,
          403: conversationErrorSchema,
          404: conversationErrorSchema,
          409: conversationErrorSchema,
          422: conversationErrorSchema,
          429: conversationRateLimitSchema,
        },
        detail: {
          summary: 'Send a private text message',
          security: openApiMutationSecurity,
          description:
            'Sender comes only from the session. Pending and approved claims are writable, including approved claims on archived listings. New message: 201. Same Idempotency-Key and normalized body: 200 with the persisted message, even after rejection. Different body: 409. Hidden listings always return 404. Process-local attempt budget: 30/minute per user and conversation, after replay and writable checks; DB rollback does not refund it. A 429 includes Retry-After seconds. Messages cannot be edited or deleted.',
        },
      },
    )
    .post(
      '/conversations/:conversationId/read',
      async ({ auth, params, body, status }) => {
        const result = await readConversation({
          conversationId: params.conversationId,
          userId: auth.user.id,
          messageId: body.messageId,
        });
        if (!result.ok) {
          const { status: code, ...error } = CONVERSATION_ERRORS[result.reason];
          return status(code, { error });
        }
        return result.value;
      },
      {
        authenticated: true,
        params: conversationParamsSchema,
        parse: 'json',
        body: readConversationBodySchema,
        transform({ body }) {
          validateConversationBody(body, readConversationBodySchema);
        },
        response: {
          200: readConversationResponseSchema,
          400: conversationErrorSchema,
          403: conversationErrorSchema,
          404: conversationErrorSchema,
          422: conversationErrorSchema,
        },
        detail: {
          summary: 'Acknowledge displayed messages',
          security: openApiMutationSecurity,
          description:
            'Send the last actually displayed message ID while the conversation is active. The pointer only advances; stale and repeated reads return current state. Only incoming messages above it count as unread. A missing or foreign message returns 404. Hidden listings and nonparticipants return 404; rejected conversations remain readable.',
        },
      },
    );
