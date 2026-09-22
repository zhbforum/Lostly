import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { LISTING_IMAGE_CONSTRAINTS } from '@lostly/contracts/listings';
import { listings } from './schema';

export const listingImages = pgTable(
  'listing_images',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('listing_images_object_key_unique').on(table.objectKey),
    index('listing_images_order_idx').on(table.listingId, table.position, table.id),
    check(
      'listing_images_size_check',
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= ${sql.raw(String(LISTING_IMAGE_CONSTRAINTS.maxSizeBytes))}`,
    ),
    check('listing_images_position_check', sql`${table.position} >= 0`),
    check('listing_images_dimensions_check', sql`${table.width} > 0 AND ${table.height} > 0`),
    check(
      'listing_images_content_type_check',
      sql`${table.contentType} IN ('image/jpeg', 'image/png', 'image/webp')`,
    ),
  ],
);

// Retained after image deletion so a delayed retry cannot resurrect a deleted photo.
// The parent cascade bounds retention to the lifetime of the report.
export const listingImageUploads = pgTable(
  'listing_image_uploads',
  {
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id').notNull(),
    sourceHash: text('source_hash').notNull(),
    imageId: uuid('image_id').references(() => listingImages.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('listing_image_uploads_request_unique').on(table.listingId, table.requestId),
    index('listing_image_uploads_image_idx').on(table.imageId),
  ],
);
