-- Setup facts as records (ADR-0169, design §3.7): a ruleset body may now carry
-- the two setup records beside the decision table. `fact_definitions.v1` holds
-- the facts a country's setup knows, its subdivisions and its derivations;
-- `fact_sources.v1` the documents that settle a fact, and why. Each schema
-- serves its own purpose and no other, as `decision_table.v1` serves only the
-- four decision purposes (0204). The zod wire (`bff/base-knowledge/wire/`)
-- checks the payloads; these CHECKs hold the pairing for any writer.
ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_schema_known;
ALTER TABLE "knowledge_ruleset_revisions" ADD CONSTRAINT knowledge_ruleset_revisions_schema_known CHECK (
  "payload_schema" IS NULL OR "payload_schema" IN ('decision_table.v1', 'fact_definitions.v1', 'fact_sources.v1'));
ALTER TABLE "knowledge_ruleset_revisions" ADD CONSTRAINT knowledge_ruleset_revisions_setup_purpose CHECK (
  ("payload_schema" IS DISTINCT FROM 'fact_definitions.v1' OR "purpose" = 'fact_definitions')
  AND ("payload_schema" IS DISTINCT FROM 'fact_sources.v1' OR "purpose" = 'fact_sources'));
