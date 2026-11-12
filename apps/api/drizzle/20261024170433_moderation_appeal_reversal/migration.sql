ALTER TYPE "moderation_action" ADD VALUE 'restore_archived_listing' BEFORE 'suspend_user';--> statement-breakpoint
ALTER TYPE "moderation_action" ADD VALUE 'reopen_claim' BEFORE 'suspend_user';