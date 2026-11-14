-- When an index run handed its text to the corpus (`knowledge_index_runs.handed_at`).
-- Additive: one nullable column.
--
-- A retried run asks it before it re-ingests: a run that handed the text on and
-- now finds it ingested with its country only titles it, where it used to ingest
-- the text again (up to three ingests a text on prod's AT carry, 2026-11-14).
-- A retry is no proof of a hand-off, since an attempt can fail before it: only
-- this column is. NULL on every run from before it, which re-ingest as they did.
ALTER TABLE "knowledge_index_runs" ADD COLUMN IF NOT EXISTS "handed_at" timestamptz;
