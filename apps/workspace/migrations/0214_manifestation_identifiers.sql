-- 0214: a manifestation names where its text lives at its source (ADR-0175).
--
-- ## What was missing
--
-- A passage the agent reads live at a source (the Wiener Bauordnung through
-- `ris_lookup`) found its edition, and so its role, only through a base-corpus
-- file (`corpus_file`). With the host regex gone (`citations/binding.py`), a
-- passage from RIS had no way to its edition at all.
--
-- ## The shape
--
-- `identifiers` on a manifestation's revision: the source's own identifiers of
-- this text, the same shape as an authority's (`{"ris_gesetzesnummer":
-- "20000006", "eli": "https://…"}`), proposed, reviewed and released like every
-- other claim. The turn carries them per edition as `sourceRefs`
-- (`key:value`), and a cited passage maps to its edition by them. A JSON
-- object, never another shape (`knowledge_manifestation_revisions_identifiers_object`).
ALTER TABLE "knowledge_manifestation_revisions"
  ADD COLUMN IF NOT EXISTS "identifiers" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "knowledge_manifestation_revisions"
  ADD CONSTRAINT knowledge_manifestation_revisions_identifiers_object CHECK (jsonb_typeof("identifiers") = 'object');
