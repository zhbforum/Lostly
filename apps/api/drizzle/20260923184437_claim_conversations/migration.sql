CREATE TABLE "claim_conversation_members" (
	"conversation_id" uuid,
	"user_id" uuid,
	"last_read_sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_conversation_members_pkey" PRIMARY KEY("conversation_id","user_id"),
	CONSTRAINT "claim_conversation_members_read_check" CHECK ("last_read_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "claim_conversations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"claim_id" uuid NOT NULL,
	"next_message_sequence" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone,
	CONSTRAINT "claim_conversations_sequence_check" CHECK ("next_message_sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "claim_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"conversation_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"client_operation_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_messages_sequence_check" CHECK ("sequence" > 0),
	CONSTRAINT "claim_messages_body_length_check" CHECK (char_length("body") BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE INDEX "claim_conversation_members_user_idx" ON "claim_conversation_members" ("user_id","conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_conversations_claim_unique" ON "claim_conversations" ("claim_id");--> statement-breakpoint
CREATE INDEX "claim_conversations_activity_idx" ON "claim_conversations" (coalesce("last_message_at", "created_at") DESC,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "claim_messages_sequence_unique" ON "claim_messages" ("conversation_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_messages_operation_unique" ON "claim_messages" ("conversation_id","sender_user_id","client_operation_id");--> statement-breakpoint
ALTER TABLE "claim_conversation_members" ADD CONSTRAINT "claim_conversation_members_ocUkEu18TLrm_fkey" FOREIGN KEY ("conversation_id") REFERENCES "claim_conversations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "claim_conversation_members" ADD CONSTRAINT "claim_conversation_members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "claim_conversations" ADD CONSTRAINT "claim_conversations_claim_id_claims_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "claim_messages" ADD CONSTRAINT "claim_messages_conversation_id_claim_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "claim_conversations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "claim_messages" ADD CONSTRAINT "claim_messages_sender_member_fkey" FOREIGN KEY ("conversation_id","sender_user_id") REFERENCES "claim_conversation_members"("conversation_id","user_id");
--> statement-breakpoint
INSERT INTO "claim_conversations" ("claim_id", "created_at")
SELECT "id", "created_at" FROM "claims";
--> statement-breakpoint
INSERT INTO "claim_conversation_members" ("conversation_id", "user_id", "created_at")
SELECT conversation."id", claim."claimant_user_id", conversation."created_at"
FROM "claim_conversations" conversation
JOIN "claims" claim ON claim."id" = conversation."claim_id"
UNION ALL
SELECT conversation."id", listing."created_by_user_id", conversation."created_at"
FROM "claim_conversations" conversation
JOIN "claims" claim ON claim."id" = conversation."claim_id"
JOIN "listings" listing ON listing."id" = claim."listing_id";
