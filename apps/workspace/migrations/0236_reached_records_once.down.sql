-- Reverse 0236. ORDER: roll the frontend back first; the newer build's
-- `recordReadable` names `knowledge_reached_ids()`.
--
-- Lossless: 0228's records policy again reads the reach row by row.
SELECT secure_table('knowledge_records',
  'organization_id = current_org() OR (organization_id IS NULL AND type <> ''golden_case'' AND head_revision_id IS NOT NULL '
  'AND (knowledge_country_entitled(country_id) OR knowledge_reached_by_relation(id)))');
--> statement-breakpoint
DROP FUNCTION IF EXISTS knowledge_reached_ids();
