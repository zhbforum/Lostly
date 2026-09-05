import { t } from 'elysia';

export const pageQueryProperties = {
  cursor: t.Optional(t.String({ minLength: 1, maxLength: 1000 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50, multipleOf: 1 })),
};

export const pageQuerySchema = t.Object(pageQueryProperties);
export const pageInfoSchema = t.Object({
  endCursor: t.Nullable(t.String()),
  hasNextPage: t.Boolean(),
});
