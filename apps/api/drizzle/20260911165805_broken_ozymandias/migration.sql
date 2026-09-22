CREATE TABLE "listing_image_uploads" (
	"listing_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"source_hash" text NOT NULL,
	"image_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_images" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"listing_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_images_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 5242880),
	CONSTRAINT "listing_images_position_check" CHECK ("position" >= 0),
	CONSTRAINT "listing_images_dimensions_check" CHECK ("width" > 0 AND "height" > 0),
	CONSTRAINT "listing_images_content_type_check" CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "listing_image_uploads_request_unique" ON "listing_image_uploads" ("listing_id","request_id");--> statement-breakpoint
CREATE INDEX "listing_image_uploads_image_idx" ON "listing_image_uploads" ("image_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_images_object_key_unique" ON "listing_images" ("object_key");--> statement-breakpoint
CREATE INDEX "listing_images_order_idx" ON "listing_images" ("listing_id","position","id");--> statement-breakpoint
ALTER TABLE "listing_image_uploads" ADD CONSTRAINT "listing_image_uploads_listing_id_listings_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "listing_image_uploads" ADD CONSTRAINT "listing_image_uploads_image_id_listing_images_id_fkey" FOREIGN KEY ("image_id") REFERENCES "listing_images"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_listing_id_listings_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE;