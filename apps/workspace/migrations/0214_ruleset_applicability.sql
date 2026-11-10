-- Applicability as a ruleset (ADR-0176): a decision table that targets one
-- work and answers, from a building's facts, whether that work applies to it
-- (`applies`, `check`, `not_applicable`). The chain narrows by it, so OIB-RL
-- 2.1 is named for a Betriebsbau and not for a block of flats. A fifth
-- decision purpose: both CHECKs that list the purposes take it.
ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_purpose_known;
--> statement-breakpoint
ALTER TABLE "knowledge_ruleset_revisions" ADD CONSTRAINT knowledge_ruleset_revisions_purpose_known CHECK (
  "purpose" IN ('classification', 'derivation', 'reference_date', 'competence', 'applicability',
    'fact_definitions', 'fact_sources', 'advice_policy', 'terminology'));
--> statement-breakpoint
ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_table_purpose;
--> statement-breakpoint
ALTER TABLE "knowledge_ruleset_revisions" ADD CONSTRAINT knowledge_ruleset_revisions_table_purpose CHECK (
  "payload_schema" IS DISTINCT FROM 'decision_table.v1'
  OR "purpose" IN ('classification', 'derivation', 'reference_date', 'competence', 'applicability'));
--> statement-breakpoint
-- An applicability table speaks for the works it names, never for every work.
ALTER TABLE "knowledge_ruleset_revisions" ADD CONSTRAINT knowledge_ruleset_revisions_applicability_targets CHECK (
  "purpose" <> 'applicability' OR cardinality("work_ids") >= 1);
