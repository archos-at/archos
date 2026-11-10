-- Reverse 0208. ORDER: roll the frontend back first; the newer build writes
-- captures and reads `source_checked`.
--
-- Lossy: every citation capture and every reviewer's source check go. Records
-- that cite a capture keep the capture's id in their provenance, unresolvable.
DROP TRIGGER IF EXISTS knowledge_review_decisions_source_check_not_by_author ON "knowledge_review_decisions";
DROP FUNCTION IF EXISTS knowledge_source_check_not_by_author();
DROP TRIGGER IF EXISTS knowledge_approvals_sources_checked ON "knowledge_approvals";
DROP FUNCTION IF EXISTS knowledge_approval_sources_checked();
ALTER TABLE "knowledge_review_decisions" DROP COLUMN IF EXISTS "source_checked";
DROP TABLE IF EXISTS "knowledge_citation_captures";
DROP FUNCTION IF EXISTS knowledge_capture_into_draft();
