-- Reverse 0212. ORDER: roll the frontend back first; the newer build reads
-- coverage and connecting factors and writes both tables.
--
-- Lossy: every coverage claim and connecting factor on a revision, every
-- recorded edition use and every confirmed Steckbrief go.
DROP TABLE IF EXISTS "project_base_confirmations";
DROP TABLE IF EXISTS "message_edition_uses";
ALTER TABLE "knowledge_work_revisions" DROP CONSTRAINT IF EXISTS knowledge_work_revisions_connects_by_known;
ALTER TABLE "knowledge_work_revisions" DROP COLUMN IF EXISTS "connects_by";
ALTER TABLE "knowledge_territory_revisions" DROP CONSTRAINT IF EXISTS knowledge_territory_revisions_coverage_known;
ALTER TABLE "knowledge_territory_revisions" DROP COLUMN IF EXISTS "municipal_law";
ALTER TABLE "knowledge_territory_revisions" DROP COLUMN IF EXISTS "coverage_level";
