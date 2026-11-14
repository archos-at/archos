-- Undo 0236: 0228's records policy again (the entitlement and the reach read
-- row by row), and both set functions gone. Run with the previous build's
-- pods: `recordReadable` of this build names both functions.
--
-- Lossless: the per-row functions answer what the sets did.
SELECT secure_table('knowledge_records',
  'organization_id = current_org() OR (organization_id IS NULL AND type <> ''golden_case'' AND head_revision_id IS NOT NULL '
  'AND (knowledge_country_entitled(country_id) OR knowledge_reached_by_relation(id)))');
--> statement-breakpoint
DROP FUNCTION IF EXISTS knowledge_reached_ids();
--> statement-breakpoint
DROP FUNCTION IF EXISTS knowledge_entitled_countries();
