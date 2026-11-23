-- Reverse 0249. ORDER: roll the frontend back first; the newer build writes
-- filings, which the old CHECKs refuse.
--
-- A filing becomes what the old CHECKs know of a version published without an
-- approver: an upload. That is the closest the old vocabulary can say.
UPDATE "document_versions" SET "origin" = 'upload' WHERE "origin" = 'filing';
--> statement-breakpoint
ALTER TABLE "document_versions" DROP CONSTRAINT IF EXISTS "document_versions_origin_known";
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_origin_known"
  CHECK ("origin" IN ('upload', 'draft'));
--> statement-breakpoint
ALTER TABLE "document_versions" DROP CONSTRAINT IF EXISTS "document_versions_published_is_approved";
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_published_is_approved"
  CHECK ("state" <> 'published' OR "origin" = 'upload' OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL));
