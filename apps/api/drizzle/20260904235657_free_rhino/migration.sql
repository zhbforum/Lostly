ALTER TABLE "claims" ADD COLUMN "handover_details" text;--> statement-breakpoint
CREATE UNIQUE INDEX "claims_one_approved_per_listing" ON "claims" ("listing_id") WHERE "status" = 'approved';