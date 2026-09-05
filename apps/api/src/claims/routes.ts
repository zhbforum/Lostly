import { Elysia } from 'elysia';

import { authenticationPlugin } from '@/auth/plugin';
import {
  claimErrorResponseSchema,
  claimIdParamsSchema,
  claimResponseSchema,
  createClaimBodySchema,
  decideClaimBodySchema,
  incomingClaimsResponseSchema,
  listingIdParamsSchema,
} from '@/claims/model';
import { createClaim, decideClaim, findIncomingClaims } from '@/claims/service';
import { trimFields } from '@/http/normalize';
import { pageQuerySchema } from '@/pagination/model';

const CLAIM_ERRORS = {
  'invalid-cursor': { status: 400, code: 'INVALID_CURSOR', message: 'Invalid claim cursor' },
  'listing-not-found': {
    status: 404,
    code: 'LISTING_NOT_FOUND',
    message: 'Listing not found',
  },
  'listing-not-claimable': {
    status: 409,
    code: 'LISTING_NOT_CLAIMABLE',
    message: 'Only active found listings can be claimed',
  },
  'cannot-claim-own-listing': {
    status: 403,
    code: 'CANNOT_CLAIM_OWN_LISTING',
    message: 'You cannot claim your own listing',
  },
  'claim-already-exists': {
    status: 409,
    code: 'CLAIM_ALREADY_EXISTS',
    message: 'You have already submitted a claim for this listing',
  },
  'claim-not-found': {
    status: 404,
    code: 'CLAIM_NOT_FOUND',
    message: 'Claim not found',
  },
  'review-forbidden': {
    status: 403,
    code: 'CLAIM_REVIEW_FORBIDDEN',
    message: 'Only the listing owner can review claims',
  },
  'claim-already-decided': {
    status: 409,
    code: 'CLAIM_ALREADY_DECIDED',
    message: 'This claim can no longer be reviewed',
  },
} as const;

export const claimRoutes = new Elysia()
  .use(authenticationPlugin)
  .post(
    '/listings/:id/claims',
    async ({ auth, body, params, status }) => {
      const result = await createClaim({
        listingId: params.id,
        claimantUserId: auth.user.id,
        verificationDetails: body.verificationDetails,
      });

      if (!result.ok) {
        const error = CLAIM_ERRORS[result.reason];

        return status(error.status, {
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      return status(201, { claim: result.value });
    },
    {
      authenticated: true,
      params: listingIdParamsSchema,
      body: createClaimBodySchema,
      transform({ body }) {
        trimFields(body, ['verificationDetails']);
      },
      response: {
        201: claimResponseSchema,
        400: claimErrorResponseSchema,
        403: claimErrorResponseSchema,
        404: claimErrorResponseSchema,
        409: claimErrorResponseSchema,
      },
    },
  )
  .get(
    '/listings/:id/claims',
    async ({ auth, params, query, status }) => {
      const result = await findIncomingClaims(params.id, auth.user.id, query);

      if (!result.ok) {
        const error = CLAIM_ERRORS[result.reason];

        return status(error.status, {
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      return result.value;
    },
    {
      authenticated: true,
      params: listingIdParamsSchema,
      query: pageQuerySchema,
      response: {
        200: incomingClaimsResponseSchema,
        400: claimErrorResponseSchema,
        403: claimErrorResponseSchema,
        404: claimErrorResponseSchema,
        409: claimErrorResponseSchema,
      },
    },
  )
  .patch(
    '/claims/:claimId',
    async ({ auth, body, params, status }) => {
      const result = await decideClaim({
        ...body,
        claimId: params.claimId,
        reviewerUserId: auth.user.id,
      });

      if (!result.ok) {
        const error = CLAIM_ERRORS[result.reason];

        return status(error.status, {
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      return { claim: result.value };
    },
    {
      authenticated: true,
      params: claimIdParamsSchema,
      body: decideClaimBodySchema,
      transform({ body }) {
        trimFields(body, ['handoverDetails']);
      },
      response: {
        200: claimResponseSchema,
        400: claimErrorResponseSchema,
        403: claimErrorResponseSchema,
        404: claimErrorResponseSchema,
        409: claimErrorResponseSchema,
      },
    },
  );
