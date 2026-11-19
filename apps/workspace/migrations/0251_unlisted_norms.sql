-- 0251: a norm taken off Normen & Richtlinien keeps its records (ADR-0163, amendment of 2026-11-19).
--
-- „Nicht mehr als Norm führen“ deleted the document's records, and with them
-- every Ausgabe, check and the topic it had: the toast's „Rückgängig“ could
-- only start a fresh proposal. Now it parks them instead.
--
--   unlisted_at                 when the entry was taken off; NULL while it is a norm.
--   unlisted_head_revision_id   the head it had, kept while `head_revision_id`
--                               is NULL, so every reader that reads heads sees
--                               nothing of it, as of an unconfirmed proposal.
--
-- Taking it back moves the parked head back and clears both. Only an office's
-- document record is parked; deleting the document still deletes it all.
ALTER TABLE "knowledge_records" ADD COLUMN IF NOT EXISTS "unlisted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD COLUMN IF NOT EXISTS "unlisted_head_revision_id" uuid;
--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_unlisted_is_office_document
  CHECK ("unlisted_at" IS NULL OR "document_id" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_unlisted_head_parked
  CHECK (("unlisted_at" IS NULL AND "unlisted_head_revision_id" IS NULL) OR ("unlisted_at" IS NOT NULL AND "head_revision_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_unlisted_head_fk
  FOREIGN KEY ("unlisted_head_revision_id", "id") REFERENCES "knowledge_revisions" ("revision_id", "record_id")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_records_unlisted_document_idx"
  ON "knowledge_records" ("document_id") WHERE "unlisted_at" IS NOT NULL;
