ALTER TYPE "moderation_action" ADD VALUE 'hide_listing';--> statement-breakpoint
ALTER TYPE "moderation_action" ADD VALUE 'restore_listing';--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "is_hidden" boolean DEFAULT false NOT NULL;