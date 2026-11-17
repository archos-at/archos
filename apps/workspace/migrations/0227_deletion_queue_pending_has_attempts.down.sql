-- Reverse 0227: a `pending` row may sit at the attempt cap again. No row
-- changes: the ones 0227 gave an attempt back keep it. The purger of this
-- release no longer repairs such a row, so roll its image back with this.
ALTER TABLE "deletion_queue" DROP CONSTRAINT IF EXISTS "deletion_queue_pending_has_attempts";
