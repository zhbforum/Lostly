DROP INDEX "claims_claimant_created_at_idx";--> statement-breakpoint
CREATE INDEX "claims_claimant_created_at_idx" ON "claims" ("claimant_user_id","created_at","id");--> statement-breakpoint
DROP INDEX "listings_created_by_user_id_idx";--> statement-breakpoint
CREATE INDEX "listings_created_by_user_id_idx" ON "listings" ("created_by_user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "claims_listing_feed_idx" ON "claims" ("listing_id","created_at","id");--> statement-breakpoint
CREATE INDEX "listings_active_occurrence_idx" ON "listings" ("status","occurred_on","id");--> statement-breakpoint
CREATE INDEX "listings_active_kind_occurrence_idx" ON "listings" ("status","kind","occurred_on","id");