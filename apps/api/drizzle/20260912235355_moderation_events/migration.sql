CREATE TYPE "moderation_action" AS ENUM('archive_listing', 'reject_claim');--> statement-breakpoint
CREATE TABLE "moderation_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"actor_user_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"action" "moderation_action" NOT NULL,
	"reason" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
