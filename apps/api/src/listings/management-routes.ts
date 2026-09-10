import { Elysia, ValidationError } from 'elysia';

import { authenticationPlugin } from '@/auth/plugin';
import { trimFields } from '@/http/normalize';
import {
  archiveOwnedListing,
  resolveOwnedListing,
  updateOwnedListing,
} from '@/listings/management';
import {
  listingIdParamsSchema,
  listingManagementErrorResponseSchema,
  listingResponseSchema,
  updateListingBodySchema,
} from '@/listings/model';
import { openApiMutationSecurity } from '@/openapi';

const MANAGEMENT_ERRORS = {
  'listing-not-found': {
    status: 404,
    code: 'LISTING_NOT_FOUND',
    message: 'Listing not found',
  },
  'update-forbidden': {
    status: 403,
    code: 'LISTING_UPDATE_FORBIDDEN',
    message: 'Only the report owner can edit this report',
  },
  'resolve-forbidden': {
    status: 403,
    code: 'LISTING_RESOLVE_FORBIDDEN',
    message: 'Only the report owner can resolve this report',
  },
  'archive-forbidden': {
    status: 403,
    code: 'LISTING_ARCHIVE_FORBIDDEN',
    message: 'Only the report owner can archive this report',
  },
  'not-editable': {
    status: 409,
    code: 'LISTING_NOT_EDITABLE',
    message: 'This report can no longer be edited because its status has changed.',
  },
  'version-conflict': {
    status: 409,
    code: 'LISTING_VERSION_CONFLICT',
    message: 'This report has been updated since you started editing it.',
  },
  'not-resolvable': {
    status: 409,
    code: 'LISTING_NOT_RESOLVABLE',
    message: 'Only active reports can be resolved',
  },
  'already-archived': {
    status: 409,
    code: 'LISTING_ALREADY_ARCHIVED',
    message: 'This report is already archived',
  },
} as const;

const managementResponse = {
  200: listingResponseSchema,
  403: listingManagementErrorResponseSchema,
  404: listingManagementErrorResponseSchema,
  409: listingManagementErrorResponseSchema,
};

export const listingManagementRoutes = new Elysia({
  prefix: '/listings',
  detail: {
    tags: ['Listings'],
  },
})
  .use(authenticationPlugin)
  .patch(
    '/:id',
    async ({ auth, body, params, status }) => {
      const result = await updateOwnedListing({
        listingId: params.id,
        ownerUserId: auth.user.id,
        expectedVersion: body.expectedVersion,
        title: body.title,
        description: body.description,
        location: body.location,
        occurredOn: body.occurredOn,
      });

      if (!result.ok) {
        const error = MANAGEMENT_ERRORS[result.reason];

        return status(error.status, {
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      return {
        listing: result.value,
      };
    },
    {
      authenticated: true,
      params: listingIdParamsSchema,
      body: updateListingBodySchema,
      transform({ body }) {
        // Elysia 1.4.30 applies parent normalization after plugin composition via .use().
        // Reject unknown PATCH fields before normalization to preserve the strict contract.
        if (
          body &&
          typeof body === 'object' &&
          !Array.isArray(body) &&
          Object.keys(body).some((key) => !Object.hasOwn(updateListingBodySchema.properties, key))
        ) {
          throw new ValidationError('body', updateListingBodySchema, body);
        }

        // Keep the version a JSON number; Elysia otherwise coerces numeric strings.
        if (body && typeof body.expectedVersion !== 'number') {
          throw new ValidationError('body', updateListingBodySchema, body);
        }

        trimFields(body, ['title', 'description', 'location']);

        // Elysia 1.4's date format accepts rollover dates such as February 30.
        // PATCH must reject those before PostgreSQL sees the value.
        if (body && typeof body.occurredOn === 'string') {
          const date = new Date(body.occurredOn + 'T00:00:00.000Z');

          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(body.occurredOn) ||
            body.occurredOn.startsWith('0000-') ||
            Number.isNaN(date.getTime()) ||
            date.toISOString().slice(0, 10) !== body.occurredOn
          ) {
            throw new ValidationError('body', updateListingBodySchema, body);
          }
        }
      },
      response: managementResponse,
      detail: {
        summary: 'Edit a report',
        description:
          'Updates the editable fields of an active report owned by the authenticated user using optimistic concurrency control.',
        security: openApiMutationSecurity,
      },
    },
  )
  .post(
    '/:id/resolve',
    async ({ auth, params, status }) => {
      const result = await resolveOwnedListing({
        listingId: params.id,
        ownerUserId: auth.user.id,
      });

      if (!result.ok) {
        const error = MANAGEMENT_ERRORS[result.reason];

        return status(error.status, {
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      return {
        listing: result.value,
      };
    },
    {
      authenticated: true,
      params: listingIdParamsSchema,
      response: managementResponse,
      detail: {
        summary: 'Resolve a report',
        description:
          'Marks an active report owned by the authenticated user as resolved and rejects its pending claims.',
        security: openApiMutationSecurity,
      },
    },
  )
  .post(
    '/:id/archive',
    async ({ auth, params, status }) => {
      const result = await archiveOwnedListing({
        listingId: params.id,
        ownerUserId: auth.user.id,
      });

      if (!result.ok) {
        const error = MANAGEMENT_ERRORS[result.reason];

        return status(error.status, {
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      return {
        listing: result.value,
      };
    },
    {
      authenticated: true,
      params: listingIdParamsSchema,
      response: managementResponse,
      detail: {
        summary: 'Archive a report',
        description:
          'Archives an active or resolved report owned by the authenticated user. Archiving an active report rejects its pending claims.',
        security: openApiMutationSecurity,
      },
    },
  );
