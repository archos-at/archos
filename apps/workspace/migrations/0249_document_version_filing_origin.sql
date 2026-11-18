-- 0249: a version can begin as a filing (ADR-0054, update of 2026-11-18).
--
--   upload  a person put the bytes there.
--   filing  a person filed a file the agent made, from its card or by asking
--           the agent to. The person who files it signs it off: born
--           `published`, with the filer as `published_by` and no approver.
--   draft   it began as a draft and becomes `published` only through an
--           approval in a review round.
--
-- Both CHECKs are dropped and added again with the new value. No row is
-- rewritten. NOT VALID, as 0223 and 0227 do: every existing row already holds
-- under the wider rule, and the deploy does not scan the table to prove it.
ALTER TABLE "document_versions" DROP CONSTRAINT IF EXISTS "document_versions_origin_known";
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_origin_known"
  CHECK ("origin" IN ('upload', 'filing', 'draft')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "document_versions" DROP CONSTRAINT IF EXISTS "document_versions_published_is_approved";
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_published_is_approved"
  CHECK ("state" <> 'published' OR "origin" IN ('upload', 'filing') OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL)) NOT VALID;
