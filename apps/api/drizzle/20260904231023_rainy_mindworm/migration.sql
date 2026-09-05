CREATE TYPE "claim_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"listing_id" uuid NOT NULL,
	"claimant_user_id" uuid NOT NULL,
	"status" "claim_status" DEFAULT 'pending'::"claim_status" NOT NULL,
	"verification_details" text NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "claims_listing_claimant_unique" ON "claims" ("listing_id","claimant_user_id");--> statement-breakpoint
CREATE INDEX "claims_listing_status_created_at_idx" ON "claims" ("listing_id","status","created_at");--> statement-breakpoint
CREATE INDEX "claims_claimant_created_at_idx" ON "claims" ("claimant_user_id","created_at");--> statement-breakpoint
CREATE INDEX "listings_active_feed_idx" ON "listings" ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "listings_active_kind_feed_idx" ON "listings" ("status","kind","created_at","id");--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_listing_id_listings_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claimant_user_id_users_id_fkey" FOREIGN KEY ("claimant_user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_reviewed_by_user_id_users_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id");