ALTER TYPE "moderation_action" ADD VALUE 'suspend_user';--> statement-breakpoint
ALTER TYPE "moderation_action" ADD VALUE 'unsuspend_user';--> statement-breakpoint
ALTER TYPE "moderation_action" ADD VALUE 'revoke_sessions';--> statement-breakpoint
ALTER TYPE "moderation_action" ADD VALUE 'reset_profile';--> statement-breakpoint
ALTER TYPE "moderation_action" ADD VALUE 'hide_listing_image';--> statement-breakpoint
ALTER TYPE "moderation_action" ADD VALUE 'restore_listing_image';--> statement-breakpoint
ALTER TYPE "moderation_action" ADD VALUE 'hide_message';--> statement-breakpoint
ALTER TYPE "moderation_action" ADD VALUE 'restore_message';--> statement-breakpoint
ALTER TYPE "moderation_action" ADD VALUE 'close_conversation';--> statement-breakpoint
ALTER TYPE "moderation_action" ADD VALUE 'reopen_conversation';--> statement-breakpoint
ALTER TYPE "moderation_action" ADD VALUE 'assign_case';--> statement-breakpoint
ALTER TYPE "moderation_action" ADD VALUE 'resolve_case';--> statement-breakpoint
ALTER TYPE "moderation_action" ADD VALUE 'dismiss_case';--> statement-breakpoint
ALTER TYPE "moderation_action" ADD VALUE 'view_case_evidence';--> statement-breakpoint
ALTER TYPE "moderation_action" ADD VALUE 'add_case_note';--> statement-breakpoint
CREATE TABLE "moderation_cases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"kind" text DEFAULT 'report' NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reporter_id" uuid,
	"assignee_id" uuid,
	"category" text NOT NULL,
	"description" varchar(2000) NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_event_id" uuid,
	"public_resolution" varchar(1000),
	"evidence" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_cases_status_check" CHECK ("status" IN ('open','in_review','resolved','dismissed')),
	CONSTRAINT "moderation_cases_kind_check" CHECK ("kind" IN ('report','appeal'))
);
--> statement-breakpoint
CREATE TABLE "moderation_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"case_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"body" varchar(2000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"title" varchar(120) NOT NULL,
	"message" varchar(1000) NOT NULL,
	"can_appeal" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "moderation_events" ADD COLUMN "target_type" text DEFAULT 'listing' NOT NULL;--> statement-breakpoint
ALTER TABLE "moderation_events" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "moderation_events" ADD COLUMN "parent_event_id" uuid;--> statement-breakpoint
ALTER TABLE "moderation_events" ADD COLUMN "metadata" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_permanently" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspension_reason" varchar(1000);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "moderation_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_images" ADD COLUMN "is_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_conversations" ADD COLUMN "moderation_closed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_conversations" ADD COLUMN "content_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_messages" ADD COLUMN "is_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "moderation_cases_queue_idx" ON "moderation_cases" ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "moderation_cases_assignee_idx" ON "moderation_cases" ("assignee_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "moderation_cases_reporter_idx" ON "moderation_cases" ("reporter_id","created_at","id");--> statement-breakpoint
CREATE INDEX "moderation_cases_target_idx" ON "moderation_cases" ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_cases_open_report_unique" ON "moderation_cases" ("reporter_id","target_type","target_id") WHERE "kind" = 'report' AND "status" IN ('open', 'in_review');--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_cases_appeal_unique" ON "moderation_cases" ("reporter_id","parent_event_id");--> statement-breakpoint
CREATE INDEX "moderation_events_created_idx" ON "moderation_events" ("created_at","id");--> statement-breakpoint
CREATE INDEX "moderation_events_case_idx" ON "moderation_events" ("case_id","created_at","id");--> statement-breakpoint
CREATE INDEX "moderation_notes_case_idx" ON "moderation_notes" ("case_id","created_at","id");--> statement-breakpoint
CREATE INDEX "moderation_notifications_user_idx" ON "moderation_notifications" ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "moderation_notifications_unread_idx" ON "moderation_notifications" ("user_id") WHERE "read_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_notifications_event_user_unique" ON "moderation_notifications" ("event_id","user_id");--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_reporter_id_users_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_assignee_id_users_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "moderation_notes" ADD CONSTRAINT "moderation_notes_case_id_moderation_cases_id_fkey" FOREIGN KEY ("case_id") REFERENCES "moderation_cases"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "moderation_notifications" ADD CONSTRAINT "moderation_notifications_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
UPDATE "moderation_events" SET "target_type" = 'claim' WHERE "action"::text = 'reject_claim';
