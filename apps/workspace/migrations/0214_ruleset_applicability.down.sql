-- Reverse 0214. ORDER: roll the frontend back first; the newer build reads
-- applicability rulesets into the chain.
--
-- Lossy: every ruleset that ever held an applicability table goes with its
-- whole history (records, not revisions: revisions go only with their record,
-- by cascade). The chain then names every work its routes reach, as before.
DELETE FROM "knowledge_records" WHERE "type" = 'ruleset' AND "id" IN (
  SELECT "record_id" FROM "knowledge_ruleset_revisions" WHERE "purpose" = 'applicability');
ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_applicability_targets;
ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_table_purpose;
ALTER TABLE "knowledge_ruleset_revisions" ADD CONSTRAINT knowledge_ruleset_revisions_table_purpose CHECK (
  "payload_schema" IS DISTINCT FROM 'decision_table.v1'
  OR "purpose" IN ('classification', 'derivation', 'reference_date', 'competence'));
ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_purpose_known;
ALTER TABLE "knowledge_ruleset_revisions" ADD CONSTRAINT knowledge_ruleset_revisions_purpose_known CHECK (
  "purpose" IN ('classification', 'derivation', 'reference_date', 'competence',
    'fact_definitions', 'fact_sources', 'advice_policy', 'terminology'));
