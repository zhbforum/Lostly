CREATE TABLE "moderation_evidence" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"purged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD COLUMN "evidence_id" uuid;--> statement-breakpoint
ALTER TABLE "moderation_events" ADD COLUMN "evidence_id" uuid;--> statement-breakpoint
CREATE INDEX "moderation_evidence_expiration_idx" ON "moderation_evidence" ("expires_at","id") WHERE "purged_at" IS NULL;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_evidence_id_moderation_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "moderation_evidence"("id");--> statement-breakpoint
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_evidence_id_moderation_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "moderation_evidence"("id");
--> statement-breakpoint
-- Preserve report snapshots with their original age, without renewing retention.
INSERT INTO moderation_evidence (id, payload, created_at, expires_at)
SELECT id, evidence, created_at, created_at + interval '90 days'
FROM moderation_cases WHERE kind = 'report';
--> statement-breakpoint
-- These are the only legacy direct decisions that retained historical content.
INSERT INTO moderation_evidence (id, payload, created_at, expires_at)
SELECT id, jsonb_build_object(
  'userId', target_id,
  'text', concat_ws(E'\n', metadata->'previousProfile'->>'displayName',
    metadata->'previousProfile'->>'username', metadata->'previousProfile'->>'bio'),
  'images', CASE WHEN metadata->'previousProfile'->>'avatarId' IS NOT NULL THEN
    jsonb_build_array(jsonb_build_object(
      'id', metadata->'previousProfile'->>'avatarId',
      'objectKey', 'avatars/' || target_id::text || '/' || (metadata->'previousProfile'->>'avatarId') || '.webp',
      'width', 256, 'height', 256)) ELSE '[]'::jsonb END
), created_at, created_at + interval '90 days'
FROM moderation_events
WHERE action::text = 'reset_profile' AND jsonb_typeof(metadata->'previousProfile') = 'object';
--> statement-breakpoint
UPDATE moderation_events e SET evidence_id = e.id
FROM moderation_evidence s WHERE s.id = e.id;
--> statement-breakpoint
UPDATE moderation_cases SET evidence_id = id WHERE kind = 'report';
--> statement-breakpoint
UPDATE moderation_cases c SET evidence_id = e.evidence_id
FROM moderation_events e WHERE c.kind = 'appeal' AND c.parent_event_id = e.id;
--> statement-breakpoint
-- Old appeals may have inherited unrelated case content: use only the decision snapshot.
UPDATE moderation_cases c SET evidence = coalesce(s.payload, '{}'::jsonb)
FROM moderation_events e LEFT JOIN moderation_evidence s ON s.id = e.evidence_id
WHERE c.kind = 'appeal' AND c.parent_event_id = e.id;
--> statement-breakpoint
UPDATE moderation_cases SET evidence = jsonb_strip_nulls(jsonb_build_object(
  'listingId', CASE WHEN target_type = 'listing' THEN to_jsonb(target_id) ELSE evidence->'listingId' END,
  'userId', CASE WHEN target_type IN ('user', 'avatar') THEN to_jsonb(target_id) ELSE evidence->'userId' END,
  'claimId', CASE WHEN target_type = 'claim' THEN to_jsonb(target_id) ELSE evidence->'claimId' END,
  'conversationId', CASE WHEN target_type = 'conversation' THEN to_jsonb(target_id) ELSE evidence->'conversationId' END
));
--> statement-breakpoint
UPDATE moderation_events SET metadata = metadata - 'previousProfile' - 'previousAvatarId';
