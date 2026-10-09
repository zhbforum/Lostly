CREATE TABLE "claim_message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"message_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"object_key" text NOT NULL,
	"source_hash" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	CONSTRAINT "claim_message_attachments_position_check" CHECK ("position" >= 0 AND "position" < 4),
	CONSTRAINT "claim_message_attachments_source_hash_check" CHECK ("source_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "claim_message_attachments_content_type_check" CHECK ("content_type" = 'image/webp'),
	CONSTRAINT "claim_message_attachments_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 5242880),
	CONSTRAINT "claim_message_attachments_dimensions_check" CHECK ("width" > 0 AND "height" > 0)
);
--> statement-breakpoint
ALTER TABLE "claim_messages" ALTER COLUMN "body" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_message_attachments_position_unique" ON "claim_message_attachments" ("message_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_message_attachments_object_key_unique" ON "claim_message_attachments" ("object_key");--> statement-breakpoint
ALTER TABLE "claim_message_attachments" ADD CONSTRAINT "claim_message_attachments_message_id_claim_messages_id_fkey" FOREIGN KEY ("message_id") REFERENCES "claim_messages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "claim_messages" DROP CONSTRAINT "claim_messages_body_length_check", ADD CONSTRAINT "claim_messages_body_length_check" CHECK ("body" IS NULL OR char_length("body") BETWEEN 1 AND 2000);
