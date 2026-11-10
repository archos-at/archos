-- Reverse 0214. ORDER: roll the frontend back first; the newer build writes
-- `pdf_document` sources.
--
-- Lossy: every source record whose any revision is a `pdf_document` goes with
-- its whole history, credential and monitor state (revisions are append-only
-- and go only with their record, by cascade), so the narrower CHECK can hold.
DELETE FROM "knowledge_records" WHERE "type" = 'source' AND "id" IN (
  SELECT DISTINCT "record_id" FROM "knowledge_source_revisions" WHERE "format" = 'pdf_document');
--> statement-breakpoint
ALTER TABLE "knowledge_source_revisions" DROP CONSTRAINT IF EXISTS knowledge_source_revisions_format_known;
--> statement-breakpoint
ALTER TABLE "knowledge_source_revisions" ADD CONSTRAINT knowledge_source_revisions_format_known
  CHECK ("format" IN ('ris_xml', 'akn', 'html_statute', 'geojson'));
