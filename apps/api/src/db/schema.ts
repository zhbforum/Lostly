import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { LISTING_CONSTRAINTS, LISTING_KINDS, LISTING_STATUSES } from '@/domain/listing';
import { CLAIM_STATUSES } from '@/domain/claim';
import { USER_ROLES } from '@/domain/user';

export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const listingKindEnum = pgEnum('listing_kind', LISTING_KINDS);
export const listingStatusEnum = pgEnum('listing_status', LISTING_STATUSES);
export const claimStatusEnum = pgEnum('claim_status', CLAIM_STATUSES);
export const moderationActionEnum = pgEnum('moderation_action', [
  'archive_listing',
  'reject_claim',
  'hide_listing',
  'restore_listing',
]);

export const moderationEvents = pgTable('moderation_events', {
  id: uuid('id')
    .default(sql`uuidv7()`)
    .primaryKey(),
  // Keep historical identifiers even if the actor or target is later deleted.
  actorUserId: uuid('actor_user_id').notNull(),
  targetId: uuid('target_id').notNull(),
  action: moderationActionEnum('action').notNull(),
  reason: varchar('reason', { length: 500 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),

    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: varchar('display_name', { length: 80 }).notNull(),

    role: userRoleEnum('role').notNull().default('user'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expiration_idx').on(table.expiresAt, table.id),
  ],
);

export const listings = pgTable(
  'listings',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),

    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),

    kind: listingKindEnum('kind').notNull(),
    status: listingStatusEnum('status').notNull().default('active'),
    isHidden: boolean('is_hidden').notNull().default(false),
    version: integer('version').notNull().default(1),

    title: varchar('title', {
      length: LISTING_CONSTRAINTS.titleMaxLength,
    }).notNull(),

    description: text('description').notNull(),

    location: varchar('location', {
      length: LISTING_CONSTRAINTS.locationMaxLength,
    }).notNull(),

    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('listings_active_feed_idx').on(table.status, table.createdAt, table.id),
    index('listings_active_kind_feed_idx').on(table.status, table.kind, table.createdAt, table.id),
    index('listings_active_occurrence_idx').on(table.status, table.occurredOn, table.id),
    index('listings_active_kind_occurrence_idx').on(
      table.status,
      table.kind,
      table.occurredOn,
      table.id,
    ),
    index('listings_created_by_user_id_idx').on(table.createdByUserId, table.createdAt, table.id),
  ],
);

export const claims = pgTable(
  'claims',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),

    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),

    claimantUserId: uuid('claimant_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    status: claimStatusEnum('status').notNull().default('pending'),
    verificationDetails: text('verification_details').notNull(),
    handoverDetails: text('handover_details'),

    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('claims_listing_claimant_unique').on(table.listingId, table.claimantUserId),
    uniqueIndex('claims_one_approved_per_listing')
      .on(table.listingId)
      .where(sql`${table.status} = 'approved'`),
    index('claims_listing_status_created_at_idx').on(
      table.listingId,
      table.status,
      table.createdAt,
    ),
    index('claims_listing_feed_idx').on(table.listingId, table.createdAt, table.id),
    index('claims_claimant_created_at_idx').on(table.claimantUserId, table.createdAt, table.id),
  ],
);
