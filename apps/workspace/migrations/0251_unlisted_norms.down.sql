-- Undo 0251. ORDER: roll the frontend back first; the newer build parks records.
--
-- Lossy, as unlisting was before 0251: a parked entry's records are deleted,
-- its file stays where it lies.
DELETE FROM "knowledge_records" WHERE "unlisted_at" IS NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "knowledge_records_unlisted_document_idx";
--> statement-breakpoint
ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_unlisted_head_fk;
--> statement-breakpoint
ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_unlisted_head_parked;
--> statement-breakpoint
ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_unlisted_is_office_document;
--> statement-breakpoint
ALTER TABLE "knowledge_records" DROP COLUMN IF EXISTS "unlisted_head_revision_id";
--> statement-breakpoint
ALTER TABLE "knowledge_records" DROP COLUMN IF EXISTS "unlisted_at";
