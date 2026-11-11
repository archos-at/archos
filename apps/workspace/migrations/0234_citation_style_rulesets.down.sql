-- Reverse 0234. ORDER: roll the frontend back first; the newer build may write a
-- `citation_style` ruleset. LOSSY only if one was written: those revisions are
-- deleted, since the narrowed CHECKs cannot hold them.
DELETE FROM "knowledge_ruleset_revisions" WHERE "purpose" = 'citation_style';
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
