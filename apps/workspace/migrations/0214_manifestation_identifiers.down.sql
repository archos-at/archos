-- Reverse 0214. ORDER: roll the frontend back first; the newer build reads and
-- writes the column.
--
-- Lossy: every manifestation's source identifiers go.
ALTER TABLE "knowledge_manifestation_revisions" DROP CONSTRAINT IF EXISTS knowledge_manifestation_revisions_identifiers_object;
--> statement-breakpoint
ALTER TABLE "knowledge_manifestation_revisions" DROP COLUMN IF EXISTS "identifiers";
