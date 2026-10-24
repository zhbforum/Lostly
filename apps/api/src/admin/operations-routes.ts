import { Elysia, t } from 'elysia';
import {
  CASE_STATUSES,
  MODERATION_ACTION_LABELS,
  type ModerationAction,
} from '@lostly/contracts/moderation';
import { authenticationPlugin } from '@/auth/plugin';
import { authErrorSchema } from '@/auth/model';
import { pageQueryProperties, pageQuerySchema } from '@/pagination/model';
import { openApiMutationSecurity, openApiSessionSecurity } from '@/openapi';
import { trimFields } from '@/http/normalize';
import type { ObjectStorage } from '@/storage/object-storage';
import {
  addCaseNote,
  assignCase,
  caseDetails,
  decideCase,
  listCases,
  revealEvidence,
} from '@/moderation/cases';
import {
  auditPage,
  claimDetails,
  listAdministrators,
  listingDetails,
  moderateConversation,
  moderateListingImage,
  moderateMessage,
  operationDashboard,
  resetUserProfile,
  restrictUser,
  revokeUserSessions,
  userDetails,
  reverseCaseDecision,
} from './operations';

const uuid = t.String({ format: 'uuid' });
const params = t.Object({ id: uuid });
const reason = t.String({ minLength: 3, maxLength: 500 });
const version = t.Integer({ minimum: 1, maximum: 2147483647 });
const command = {
  reason,
  publicReason: t.Optional(t.String({ minLength: 3, maxLength: 1000 })),
  caseId: t.Optional(uuid),
};
const versioned = { ...command, expectedVersion: version };
const mutation = {
  params,
  transform: ({ body }: { body: unknown }) =>
    trimFields(body, ['reason', 'publicReason', 'publicResolution', 'body']),
  detail: { security: openApiMutationSecurity },
};

export const createAdminOperationsRoutes = (storage: ObjectStorage) =>
  new Elysia({ prefix: '/admin', detail: { tags: ['Admin'] } })
    .use(authenticationPlugin)
    .guard({ authenticated: true, response: { 403: authErrorSchema } })
    .onBeforeHandle(({ auth, status }) => {
      if (auth.user.role !== 'admin')
        return status(403, {
          error: { code: 'ADMIN_REQUIRED', message: 'Administrator access required' },
        });
    })
    .get('/operations', ({ auth }) => operationDashboard(auth.user.id), {
      detail: {
        summary: 'Get moderation workload and overdue cases',
        security: openApiSessionSecurity,
      },
    })
    .get('/administrators', listAdministrators)
    .get('/audit', ({ query }) => auditPage(query), {
      query: t.Object({
        ...pageQueryProperties,
        actorId: t.Optional(uuid),
        from: t.Optional(t.String({ format: 'date-time' })),
        to: t.Optional(t.String({ format: 'date-time' })),
        targetId: t.Optional(uuid),
        caseId: t.Optional(uuid),
        action: t.Optional(
          t.Union(
            (Object.keys(MODERATION_ACTION_LABELS) as ModerationAction[]).map((value) =>
              t.Literal(value),
            ),
          ),
        ),
      }),
      detail: { summary: 'Browse the global audit trail', security: openApiSessionSecurity },
    })
    .get('/users/:id', ({ params }) => userDetails(params.id, storage), { params })
    .get('/listings/:id', ({ params }) => listingDetails(params.id, storage), { params })
    .get('/claims/:id', ({ params }) => claimDetails(params.id), { params })
    .post(
      '/users/:id/restriction',
      async ({ auth, params, body }) => {
        await restrictUser(params.id, auth.user.id, body);
        return { ok: true };
      },
      {
        ...mutation,
        body: t.Object({
          ...versioned,
          permanent: t.Boolean(),
          until: t.Optional(t.Nullable(t.String({ format: 'date-time' }))),
          remove: t.Optional(t.Boolean()),
        }),
      },
    )
    .post(
      '/users/:id/revoke-sessions',
      async ({ auth, params, body }) => {
        await revokeUserSessions(params.id, auth.user.id, body);
        return { ok: true };
      },
      { ...mutation, body: t.Object(versioned) },
    )
    .post(
      '/users/:id/profile',
      async ({ auth, params, body }) => {
        await resetUserProfile(params.id, auth.user.id, body);
        return { ok: true };
      },
      {
        ...mutation,
        body: t.Object({
          ...versioned,
          fields: t.Array(
            t.Union([
              t.Literal('bio'),
              t.Literal('avatar'),
              t.Literal('displayName'),
              t.Literal('username'),
            ]),
            { minItems: 1, maxItems: 4, uniqueItems: true },
          ),
        }),
      },
    )
    .post(
      '/images/:id/visibility',
      async ({ auth, params, body }) => {
        await moderateListingImage(params.id, auth.user.id, body.hidden, body);
        return { ok: true };
      },
      { ...mutation, body: t.Object({ ...versioned, hidden: t.Boolean() }) },
    )
    .post(
      '/messages/:id/visibility',
      async ({ auth, params, body }) => {
        await moderateMessage(params.id, auth.user.id, body.hidden, body);
        return { ok: true };
      },
      { ...mutation, body: t.Object({ ...command, caseId: uuid, hidden: t.Boolean() }) },
    )
    .get(
      '/cases',
      ({ query }) =>
        listCases({
          ...query,
          overdue: query.overdue === 'true',
          unassigned: query.unassigned === 'true',
          active: query.active === 'true',
        }),
      {
        query: t.Object({
          ...pageQueryProperties,
          status: t.Optional(t.Union(CASE_STATUSES.map((value) => t.Literal(value)))),
          assigneeId: t.Optional(uuid),
          reporterId: t.Optional(uuid),
          targetId: t.Optional(uuid),
          kind: t.Optional(t.Union([t.Literal('report'), t.Literal('appeal')])),
          overdue: t.Optional(t.Union([t.Literal('true'), t.Literal('false')])),
          unassigned: t.Optional(t.Union([t.Literal('true'), t.Literal('false')])),
          active: t.Optional(t.Union([t.Literal('true'), t.Literal('false')])),
        }),
        detail: { summary: 'Browse reports and appeals', security: openApiSessionSecurity },
      },
    )
    .get('/cases/:id', ({ params, query }) => caseDetails(params.id, query), {
      params,
      query: pageQuerySchema,
    })
    .post(
      '/cases/:id/reverse-decision',
      async ({ auth, params, body }) => {
        await reverseCaseDecision(params.id, auth.user.id, body);
        return { ok: true };
      },
      { ...mutation, body: t.Object(versioned) },
    )
    .post(
      '/cases/:id/assign',
      async ({ auth, params, body }) => {
        await assignCase(
          params.id,
          auth.user.id,
          body.assigneeId,
          body.expectedVersion,
          body.reason,
        );
        return { ok: true };
      },
      {
        ...mutation,
        body: t.Object({ reason, expectedVersion: version, assigneeId: t.Nullable(uuid) }),
      },
    )
    .post(
      '/cases/:id/decision',
      async ({ auth, params, body }) => {
        await decideCase(
          params.id,
          auth.user.id,
          body.expectedVersion,
          body.status,
          body.publicResolution,
          body.reason,
        );
        return { ok: true };
      },
      {
        ...mutation,
        body: t.Object({
          reason,
          expectedVersion: version,
          status: t.Union([t.Literal('resolved'), t.Literal('dismissed')]),
          publicResolution: t.String({ minLength: 3, maxLength: 1000 }),
        }),
      },
    )
    .post(
      '/cases/:id/notes',
      async ({ auth, params, body }) => {
        await addCaseNote(params.id, auth.user.id, body.body);
        return { ok: true };
      },
      { ...mutation, body: t.Object({ body: t.String({ minLength: 3, maxLength: 2000 }) }) },
    )
    .post(
      '/cases/:id/evidence',
      ({ auth, params, body }) => revealEvidence(params.id, auth.user.id, body.reason, storage),
      { ...mutation, body: t.Object({ reason }) },
    )
    .post(
      '/cases/:id/conversation',
      async ({ auth, params, body }) => {
        await moderateConversation(params.id, auth.user.id, body.closed, body);
        return { ok: true };
      },
      { ...mutation, body: t.Object({ ...command, closed: t.Boolean() }) },
    );
