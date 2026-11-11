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
-- Put back the layered reads of 0211 (records) and 0205 (revisions).
SELECT secure_table('knowledge_records',
  'organization_id = current_org() OR (organization_id IS NULL AND head_revision_id IS NOT NULL '
  'AND (knowledge_country_entitled(country_id) OR knowledge_reached_by_relation(id)))');
SELECT secure_table('knowledge_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND knowledge_revision_released(revision_id) '
  'AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.id = record_id))');
