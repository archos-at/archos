-- 0233: a citation line's form is a country's record (country-as-data plan row 6,
-- docs/design/citations.md slice 2).
--
-- A country states how its sources are cited, per language, as a ruleset of the
-- new purpose `citation_style` with the payload schema `citation_style.v1`: the
-- line's template per kind of source, the locus and page labels, how an edition
-- is named and the date form. The formatter in `apps/workspace/shared/` interprets
-- it and holds no country's convention. A ruleset, not a record type of its own:
-- it already carries territories, validity, review and release, and needs no
-- body table.
--
-- Only CHECKs widen; no row is touched. Applying it twice changes nothing.

ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_purpose_known;
--> statement-breakpoint
ALTER TABLE "knowledge_ruleset_revisions" ADD CONSTRAINT knowledge_ruleset_revisions_purpose_known CHECK (
  "purpose" IN ('classification', 'derivation', 'reference_date', 'competence',
    'fact_definitions', 'fact_sources', 'advice_policy', 'terminology', 'citation_style'));
--> statement-breakpoint
ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_schema_known;
--> statement-breakpoint
ALTER TABLE "knowledge_ruleset_revisions" ADD CONSTRAINT knowledge_ruleset_revisions_schema_known CHECK (
  "payload_schema" IS NULL OR "payload_schema" IN (
    'decision_table.v1', 'fact_definitions.v1', 'fact_sources.v1', 'advice_policy.v1', 'terminology.v1',
    'citation_style.v1'));
--> statement-breakpoint
ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_citation_style_purpose;
--> statement-breakpoint
ALTER TABLE "knowledge_ruleset_revisions" ADD CONSTRAINT knowledge_ruleset_revisions_citation_style_purpose CHECK (
  "payload_schema" IS DISTINCT FROM 'citation_style.v1' OR "purpose" = 'citation_style');
