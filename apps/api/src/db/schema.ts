import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
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
  'restore_archived_listing',
  'reopen_claim',
  'suspend_user',
  'unsuspend_user',
  'revoke_sessions',
  'reset_profile',
  'hide_listing_image',
  'restore_listing_image',
  'hide_message',
  'restore_message',
  'close_conversation',
  'reopen_conversation',
  'assign_case',
  'resolve_case',
  'dismiss_case',
  'view_case_evidence',
  'add_case_note',
]);

export const moderationEvents = pgTable(
  'moderation_events',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    // Keep historical identifiers even if the actor or target is later deleted.
    actorUserId: uuid('actor_user_id').notNull(),
    targetId: uuid('target_id').notNull(),
    targetType: text('target_type').notNull().default('listing'),
    caseId: uuid('case_id'),
    parentEventId: uuid('parent_event_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    action: moderationActionEnum('action').notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('moderation_events_target_created_idx').on(table.targetId, table.createdAt, table.id),
    index('moderation_events_created_idx').on(table.createdAt, table.id),
    index('moderation_events_case_idx').on(table.caseId, table.createdAt, table.id),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),

    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    displayName: varchar('display_name', { length: 80 }).notNull(),
    username: varchar('username', { length: 30 }),
    usernameChangedAt: timestamp('username_changed_at', { withTimezone: true }),
    bio: varchar('bio', { length: 160 }).notNull().default(''),
    displayNameChangedAt: timestamp('display_name_changed_at', { withTimezone: true }),
    profileVersion: integer('profile_version').notNull().default(1),
    avatarId: uuid('avatar_id'),
    avatarAnimated: boolean('avatar_animated').notNull().default(false),

    role: userRoleEnum('role').notNull().default('user'),
    suspendedPermanently: boolean('suspended_permanently').notNull().default(false),
    suspendedUntil: timestamp('suspended_until', { withTimezone: true }),
    suspensionReason: varchar('suspension_reason', { length: 1000 }),
    moderationVersion: integer('moderation_version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`),
    uniqueIndex('users_username_unique').on(table.username),
    check('users_username_format', sql`${table.username} ~ '^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$'`),
  ],
);

export const moderationCases = pgTable(
  'moderation_cases',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    kind: text('kind').$type<'report' | 'appeal'>().notNull().default('report'),
    targetType: text('target_type')
      .$type<import('@lostly/contracts/moderation').ModerationTarget>()
      .notNull(),
    targetId: uuid('target_id').notNull(),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    category: text('category')
      .$type<import('@lostly/contracts/moderation').CaseCategory>()
      .notNull(),
    description: varchar('description', { length: 2000 }).notNull(),
    status: text('status')
      .$type<import('@lostly/contracts/moderation').CaseStatus>()
      .notNull()
      .default('open'),
    version: integer('version').notNull().default(1),
    parentEventId: uuid('parent_event_id'),
    publicResolution: varchar('public_resolution', { length: 1000 }),
    evidence: jsonb('evidence')
      .$type<{
        text?: string;
        listingId?: string;
        conversationId?: string;
        userId?: string;
        images?: { id: string; objectKey: string; width: number; height: number }[];
      }>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('moderation_cases_queue_idx').on(table.status, table.createdAt, table.id),
    index('moderation_cases_assignee_idx').on(
      table.assigneeId,
      table.status,
      table.createdAt,
      table.id,
    ),
    index('moderation_cases_reporter_idx').on(table.reporterId, table.createdAt, table.id),
    index('moderation_cases_target_idx').on(table.targetType, table.targetId),
    uniqueIndex('moderation_cases_open_report_unique')
      .on(table.reporterId, table.targetType, table.targetId)
      .where(sql`${table.kind} = 'report' AND ${table.status} IN ('open', 'in_review')`),
    uniqueIndex('moderation_cases_appeal_unique').on(table.reporterId, table.parentEventId),
    check(
      'moderation_cases_status_check',
      sql`${table.status} IN ('open','in_review','resolved','dismissed')`,
    ),
    check('moderation_cases_kind_check', sql`${table.kind} IN ('report','appeal')`),
  ],
);

export const moderationNotes = pgTable(
  'moderation_notes',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => moderationCases.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').notNull(),
    body: varchar('body', { length: 2000 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('moderation_notes_case_idx').on(table.caseId, table.createdAt, table.id)],
);

export const moderationNotifications = pgTable(
  'moderation_notifications',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    message: varchar('message', { length: 1000 }).notNull(),
    canAppeal: boolean('can_appeal').notNull().default(false),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('moderation_notifications_user_idx').on(table.userId, table.createdAt, table.id),
    index('moderation_notifications_unread_idx')
      .on(table.userId)
      .where(sql`${table.readAt} IS NULL`),
    uniqueIndex('moderation_notifications_event_user_unique').on(table.eventId, table.userId),
  ],
);

export const profileUsernames = pgTable(
  'profile_usernames',
  {
    username: varchar('username', { length: 30 }).primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('profile_usernames_user_idx').on(table.userId),
    check('profile_usernames_format', sql`${table.username} ~ '^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$'`),
  ],
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

export const authIdentities = pgTable(
  'auth_identities',
  {
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_identities_provider_subject_unique').on(table.provider, table.subject),
    uniqueIndex('auth_identities_user_provider_unique').on(table.userId, table.provider),
  ],
);

export const oauthStates = pgTable(
  'oauth_states',
  {
    stateHash: text('state_hash').primaryKey(),
    browserHash: text('browser_hash').notNull(),
    verifier: text('verifier').notNull(),
    nonce: text('nonce').notNull(),
    returnTo: text('return_to').notNull(),
    linkSessionId: uuid('link_session_id').references(() => sessions.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('oauth_states_expiration_idx').on(table.expiresAt)],
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
