CREATE TYPE "listing_kind" AS ENUM('lost', 'found');--> statement-breakpoint
CREATE TYPE "listing_status" AS ENUM('active', 'resolved', 'archived');--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"created_by_user_id" uuid NOT NULL,
	"kind" "listing_kind" NOT NULL,
	"status" "listing_status" DEFAULT 'active'::"listing_status" NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"location" varchar(160) NOT NULL,
	"occurred_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "listings_created_by_user_id_idx" ON "listings" ("created_by_user_id");--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_created_by_user_id_users_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");