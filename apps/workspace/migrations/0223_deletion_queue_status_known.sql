-- 0223: `deletion_queue.status` holds one of five values, and the database says
-- so (ADR-0179).
--
-- The column was open `text` since 0009. Its vocabulary is `DELETION_STATUSES`
-- (`bff/db/schema/deletion-queue.ts`), and the moves between the values are
-- `DELETION_LIFECYCLE` beside it:
--
--   pending   queued; waiting for its grace period, a retry or a hold's release
--   purging   claimed, by the purger or by a request („Endgültig löschen")
--   purged    erased; the row stays as the record
--   restored  taken back within the grace period
--   failed    given up after ten attempts, or refused for good; needs a person
--
-- Existing rows: none is rewritten and none is read. NOT VALID, as 0222 does
-- for `bim_models`: every writer this repository ever had writes one of the
-- five, but the column was open text since 0009 and a row nobody knows of must
-- not stop a deploy. Every insert and every later update is checked. To hold
-- the existing rows too, look first
-- (`SELECT status, count(*) FROM deletion_queue GROUP BY 1`) and then run
-- `ALTER TABLE deletion_queue VALIDATE CONSTRAINT deletion_queue_status_known`.
ALTER TABLE "deletion_queue" DROP CONSTRAINT IF EXISTS "deletion_queue_status_known";
--> statement-breakpoint
ALTER TABLE "deletion_queue"
  ADD CONSTRAINT "deletion_queue_status_known"
  CHECK ("status" IN ('pending', 'purging', 'purged', 'restored', 'failed'))
  NOT VALID;
--> statement-breakpoint
COMMENT ON COLUMN "deletion_queue"."status" IS
  'Where the deletion stands (migration 0223, ADR-0179): pending | purging | purged | restored | failed. Vocabulary and moves: bff/db/schema/deletion-queue.ts.';
