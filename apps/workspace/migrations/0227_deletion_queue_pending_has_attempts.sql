-- 0227: a `pending` deletion always has an attempt left, and the database says
-- so (ADR-0179).
--
-- The purger claims a row only below its attempt cap (`attempts < 10`,
-- `claimNext` in `purger/db.js`; the cap is `DELETION_MAX_ATTEMPTS` in
-- `bff/db/schema/deletion-queue.ts`). A row that is `pending` at the cap reads
-- as waiting and is never purged. Until November 2026 a request-side release
-- („Endgültig löschen" failing) could leave one; every writer since then
-- leaves a row at the cap `failed`, and the purger repaired the old ones on
-- every tick (`reofferExhausted`). This migration does that repair once and
-- then makes the state unwritable, so the repair is gone from the purger.
--
-- The one-time repair is what `reofferExhausted` did: the stranded row gets
-- its last attempt back, and the next purge ends it `purged` or `failed`. It
-- touches only rows that violate the rule (none, where the purger has ticked
-- since the fix). Runs as the table owner, which row-level security does not
-- bind (0031 does not FORCE it).
--
-- An older build beside this schema (a rollout's old pods, a rollback): its
-- request-side release of a folder's permanent delete at the cap sets
-- `pending` without touching `attempts`, and that UPDATE now raises, inside a
-- request that is already failing. The row stays `purging` and the purger's
-- `reapStranded` ends it `failed`, which is where this release puts it too.
--
-- NOT VALID, as 0223: no existing row is read to add the constraint. After the
-- UPDATE above none violates it, so
-- `ALTER TABLE deletion_queue VALIDATE CONSTRAINT deletion_queue_pending_has_attempts`
-- passes whenever somebody wants it validated.
UPDATE "deletion_queue" SET "attempts" = 9 WHERE "status" = 'pending' AND "attempts" >= 10;
--> statement-breakpoint
ALTER TABLE "deletion_queue" DROP CONSTRAINT IF EXISTS "deletion_queue_pending_has_attempts";
--> statement-breakpoint
ALTER TABLE "deletion_queue"
  ADD CONSTRAINT "deletion_queue_pending_has_attempts"
  CHECK ("status" <> 'pending' OR "attempts" < 10)
  NOT VALID;
