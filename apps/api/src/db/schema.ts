import { sql } from 'drizzle-orm';
import {
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { LISTING_CONSTRAINTS, LISTING_KINDS, LISTING_STATUSES } from '@/domain/listing';
import { USER_ROLES } from '@/domain/user';

export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const listingKindEnum = pgEnum('listing_kind', LISTING_KINDS);
export const listingStatusEnum = pgEnum('listing_status', LISTING_STATUSES);

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
  (table) => [index('listings_created_by_user_id_idx').on(table.createdByUserId)],
);
