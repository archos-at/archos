-- Reverse 0228. ORDER: roll the frontend back first; the newer build proposes
-- golden cases and writes golden runs.
--
-- Lossy: every golden case goes with its whole history, and every golden run
-- with its verdicts. Records, not revisions: revisions are append-only and go
-- only with their record, by cascade. Nothing an office reads changes: no turn
-- of an office reads a golden case or a run.
DROP TABLE IF EXISTS "knowledge_golden_run_cases";
DROP TABLE IF EXISTS "knowledge_golden_runs";
DELETE FROM "knowledge_records" WHERE "type" = 'golden_case';
DROP TABLE IF EXISTS "knowledge_golden_case_revisions";
ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_platform_types;
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_platform_types
  CHECK ("type" NOT IN ('territory', 'authority', 'source') OR "organization_id" IS NULL);
ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_type_known;
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_type_known
  CHECK ("type" IN ('work', 'edition', 'manifestation', 'ruleset', 'territory', 'authority', 'relation', 'source'));
