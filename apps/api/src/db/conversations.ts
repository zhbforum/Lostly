import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  CONVERSATION_CONSTRAINTS,
  CONVERSATION_IMAGE_CONSTRAINTS,
} from '@lostly/contracts/conversations';
import { claims, users } from './schema';

export const claimConversations = pgTable(
  'claim_conversations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    nextMessageSequence: integer('next_message_sequence').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('claim_conversations_claim_unique').on(table.claimId),
    index('claim_conversations_activity_idx').on(
      sql`coalesce(${table.lastMessageAt}, ${table.createdAt}) DESC`,
      table.id.desc(),
    ),
    check('claim_conversations_sequence_check', sql`${table.nextMessageSequence} > 0`),
  ],
);

export const claimConversationMembers = pgTable(
  'claim_conversation_members',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => claimConversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastReadSequence: integer('last_read_sequence').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    index('claim_conversation_members_user_idx').on(table.userId, table.conversationId),
    check('claim_conversation_members_read_check', sql`${table.lastReadSequence} >= 0`),
  ],
);

export const claimMessages = pgTable(
  'claim_messages',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => claimConversations.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    senderUserId: uuid('sender_user_id').notNull(),
    clientOperationId: uuid('client_operation_id').notNull(),
    body: text('body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('claim_messages_sequence_unique').on(table.conversationId, table.sequence),
    uniqueIndex('claim_messages_operation_unique').on(
      table.conversationId,
      table.senderUserId,
      table.clientOperationId,
    ),
    foreignKey({
      name: 'claim_messages_sender_member_fkey',
      columns: [table.conversationId, table.senderUserId],
      foreignColumns: [claimConversationMembers.conversationId, claimConversationMembers.userId],
    }),
    check('claim_messages_sequence_check', sql`${table.sequence} > 0`),
    check(
      'claim_messages_body_length_check',
      sql`${table.body} IS NULL OR char_length(${table.body}) BETWEEN 1 AND ${sql.raw(String(CONVERSATION_CONSTRAINTS.messageMaxLength))}`,
    ),
  ],
);

// A message must have text or attachments. The send transaction enforces this cross-table invariant.
export const claimMessageAttachments = pgTable(
  'claim_message_attachments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    messageId: uuid('message_id')
      .notNull()
      .references(() => claimMessages.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    objectKey: text('object_key').notNull(),
    sourceHash: text('source_hash').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
  },
  (table) => [
    uniqueIndex('claim_message_attachments_position_unique').on(table.messageId, table.position),
    uniqueIndex('claim_message_attachments_object_key_unique').on(table.objectKey),
    check(
      'claim_message_attachments_position_check',
      sql`${table.position} >= 0 AND ${table.position} < ${sql.raw(String(CONVERSATION_IMAGE_CONSTRAINTS.maxCount))}`,
    ),
    check(
      'claim_message_attachments_source_hash_check',
      sql`${table.sourceHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check('claim_message_attachments_content_type_check', sql`${table.contentType} = 'image/webp'`),
    check(
      'claim_message_attachments_size_check',
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= ${sql.raw(String(CONVERSATION_IMAGE_CONSTRAINTS.maxSizeBytes))}`,
    ),
    check(
      'claim_message_attachments_dimensions_check',
      sql`${table.width} > 0 AND ${table.height} > 0`,
    ),
  ],
);
