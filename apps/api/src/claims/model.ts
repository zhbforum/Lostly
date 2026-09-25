import { t } from 'elysia';

import { CLAIM_CONSTRAINTS, CLAIM_STATUSES } from '@/domain/claim';
import { pageInfoSchema } from '@/pagination/model';

export const claimSchema = t.Object({
  id: t.String({ format: 'uuid' }),
  conversationId: t.String({ format: 'uuid' }),
  listingId: t.String({ format: 'uuid' }),
  status: t.UnionEnum(CLAIM_STATUSES),
  verificationDetails: t.String(),
  createdAt: t.Date(),
  updatedAt: t.Date(),
  reviewedAt: t.Nullable(t.Date()),
  handoverDetails: t.Nullable(t.String()),
});

export const incomingClaimSchema = t.Composite([
  claimSchema,
  t.Object({
    claimant: t.Object({
      id: t.String({ format: 'uuid' }),
      displayName: t.String(),
    }),
  }),
]);

export const claimResponseSchema = t.Object({
  claim: claimSchema,
});

export const incomingClaimsResponseSchema = t.Object({
  claims: t.Array(incomingClaimSchema),
  pageInfo: pageInfoSchema,
});

export const listingIdParamsSchema = t.Object({
  id: t.String({ format: 'uuid' }),
});

export const claimIdParamsSchema = t.Object({
  claimId: t.String({ format: 'uuid' }),
});

export const createClaimBodySchema = t.Object({
  verificationDetails: t.String({
    minLength: CLAIM_CONSTRAINTS.verificationDetailsMinLength,
    maxLength: CLAIM_CONSTRAINTS.verificationDetailsMaxLength,
  }),
});

export const decideClaimBodySchema = t.Union([
  t.Object({
    decision: t.Literal('approved'),
    handoverDetails: t.String({
      minLength: CLAIM_CONSTRAINTS.handoverDetailsMinLength,
      maxLength: CLAIM_CONSTRAINTS.handoverDetailsMaxLength,
    }),
  }),
  t.Object({ decision: t.Literal('rejected') }),
]);

export const claimErrorResponseSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
  }),
});
