CREATE TABLE "profile_usernames" (
	"username" varchar(30) PRIMARY KEY,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_usernames_format" CHECK ("username" ~ '^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$')
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" varchar(30);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username_changed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "profile_usernames_user_idx" ON "profile_usernames" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" ("username");--> statement-breakpoint
ALTER TABLE "profile_usernames" ADD CONSTRAINT "profile_usernames_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_format" CHECK ("username" ~ '^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$');