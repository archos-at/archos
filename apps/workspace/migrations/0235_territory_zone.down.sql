-- Reverse 0235. ORDER: roll the frontend back first; the newer build reads a
-- territory's zone for an open procedure's window.
--
-- Lossy: every territory's stated zone goes. A procedure still open then
-- reads the build's zone table, or `zone_unknown` on a build without one.
ALTER TABLE "knowledge_territory_revisions" DROP COLUMN IF EXISTS "zone";
