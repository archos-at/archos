-- Reverse 0223: `deletion_queue.status` is open text again. No row changes.
ALTER TABLE "deletion_queue" DROP CONSTRAINT IF EXISTS "deletion_queue_status_known";
--> statement-breakpoint
COMMENT ON COLUMN "deletion_queue"."status" IS NULL;
