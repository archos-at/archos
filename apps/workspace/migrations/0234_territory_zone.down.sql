-- Reverse 0234. ORDER: roll the frontend back first; the newer build reads a
-- territory's zone for an open procedure's window.
--
-- Lossy: every territory's stated zone goes. A procedure still open then
-- answers `zone_unknown` until a build with the zone in code is back.
ALTER TABLE "knowledge_territory_revisions" DROP COLUMN IF EXISTS "zone";
