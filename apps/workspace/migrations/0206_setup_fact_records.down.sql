-- Reverse 0206. ORDER: roll the frontend back first; the newer build writes
-- setup records.
--
-- Lossy: every revision holding a setup record goes, with its record when that
-- was its only revision. Nothing in the product reads setup records from the
-- database yet (the setup reads the shipped pack), so no decision changes.
DELETE FROM "knowledge_records" WHERE "type" = 'ruleset' AND "head_revision_id" IN (
  SELECT "revision_id" FROM "knowledge_ruleset_revisions"
  WHERE "payload_schema" IN ('fact_definitions.v1', 'fact_sources.v1'));
DELETE FROM "knowledge_ruleset_revisions" WHERE "payload_schema" IN ('fact_definitions.v1', 'fact_sources.v1');
ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_setup_purpose;
ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_schema_known;
ALTER TABLE "knowledge_ruleset_revisions" ADD CONSTRAINT knowledge_ruleset_revisions_schema_known CHECK (
  "payload_schema" IS NULL OR "payload_schema" IN ('decision_table.v1'));
