-- Reverse 0206. ORDER: roll the frontend back first; the newer build writes
-- setup records.
--
-- Lossy: every record that ever held a setup body goes, with its whole history,
-- whether that body is its head, an older revision or a pending proposal.
-- Records, not revisions: revisions are append-only (0202's trigger refuses a
-- direct DELETE) and go only with their record, by cascade. Nothing in the
-- product reads setup records from the database yet (the setup reads the
-- shipped pack), so no decision changes.
DELETE FROM "knowledge_records" WHERE "type" = 'ruleset' AND "id" IN (
  SELECT "record_id" FROM "knowledge_ruleset_revisions"
  WHERE "payload_schema" IN ('fact_definitions.v1', 'fact_sources.v1'));
ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_setup_purpose;
ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_schema_known;
ALTER TABLE "knowledge_ruleset_revisions" ADD CONSTRAINT knowledge_ruleset_revisions_schema_known CHECK (
  "payload_schema" IS NULL OR "payload_schema" IN ('decision_table.v1'));
