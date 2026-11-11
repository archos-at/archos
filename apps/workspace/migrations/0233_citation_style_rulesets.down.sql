-- Reverse 0233. ORDER: roll the frontend back first; the newer build writes
-- `citation_style` rulesets.
--
-- Lossy: every record that ever held a citation style goes, with its whole
-- history. Records, not revisions: revisions are append-only (0202's trigger
-- refuses a direct DELETE) and go only with their record, by cascade, as 0207's
-- down does. Lines are then written in the fallback style, as before 0233.
DELETE FROM "knowledge_records" WHERE "type" = 'ruleset' AND "id" IN (
  SELECT "record_id" FROM "knowledge_ruleset_revisions"
  WHERE "purpose" = 'citation_style' OR "payload_schema" = 'citation_style.v1');
--> statement-breakpoint
ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_citation_style_purpose;
--> statement-breakpoint
ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_schema_known;
--> statement-breakpoint
ALTER TABLE "knowledge_ruleset_revisions" ADD CONSTRAINT knowledge_ruleset_revisions_schema_known CHECK (
  "payload_schema" IS NULL OR "payload_schema" IN (
    'decision_table.v1', 'fact_definitions.v1', 'fact_sources.v1', 'advice_policy.v1', 'terminology.v1'));
--> statement-breakpoint
ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_purpose_known;
--> statement-breakpoint
ALTER TABLE "knowledge_ruleset_revisions" ADD CONSTRAINT knowledge_ruleset_revisions_purpose_known CHECK (
  "purpose" IN ('classification', 'derivation', 'reference_date', 'competence',
    'fact_definitions', 'fact_sources', 'advice_policy', 'terminology'));
