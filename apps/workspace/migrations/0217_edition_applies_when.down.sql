-- Reverse 0217. ORDER: roll the frontend back first; the newer build reads an
-- edition's scope into the chain.
--
-- Lossy: every edition's scope goes. The chain then names every edition its
-- routes reach, for every building, as before.
ALTER TABLE "knowledge_edition_revisions" DROP CONSTRAINT IF EXISTS knowledge_edition_revisions_applies_when_object;
ALTER TABLE "knowledge_edition_revisions" DROP COLUMN IF EXISTS "applies_when";
