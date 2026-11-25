-- 0270: the base corpus is named `base_corpus`, no longer `oib_knowledge`.
--
-- The platform's base corpus holds every country's base documents (each point
-- carries its `country_id`), so its name no longer names one country's guidelines.
-- The search index and the Python-owned tables are renamed by the backend itself
-- (`move_legacy_base_corpus`, run by the base-corpus sync after every rollout; the
-- schema runners of `document_metadata`, `document_revision_retained` and
-- `ingest_jobs`). This rewrites what Postgres stores of the old name:
--
--   messages.metadata         citations.sources[] `collection` and `document_id`
--                             (`doc:oib_knowledge:<file>`), and every other copy of
--                             a source in the answer's metadata
--   citation_events.detail    the same identifiers in the citation-health ledger
--
-- Only the exact tokens change: a JSON string that is the whole name
-- (`"oib_knowledge"`) and a document id prefix (`doc:oib_knowledge:`). Prose that
-- merely contains the word does not match. Golden cases name designations, not
-- collections, and their revisions are append-only, so they are not touched.
--
-- ## Idempotent, lock and RLS
--
-- A re-run finds no row. One statement per table, row locks on the affected rows
-- only, as 0163. It runs as the owner, which row-level security does not restrict,
-- so every tenant's rows are rewritten. The readers accept both names for one
-- release (`LEGACY_BASE_CORPUS_COLLECTION`), so it is not on the critical path of a
-- deploy.

UPDATE "messages"
SET "metadata" = replace(replace("metadata"::text, 'doc:oib_knowledge:', 'doc:base_corpus:'), '"oib_knowledge"', '"base_corpus"')::jsonb
WHERE "metadata"::text ~ '"oib_knowledge"|doc:oib_knowledge:';
--> statement-breakpoint
UPDATE "citation_events"
SET "detail" = replace(replace("detail"::text, 'doc:oib_knowledge:', 'doc:base_corpus:'), '"oib_knowledge"', '"base_corpus"')::jsonb
WHERE "detail"::text ~ '"oib_knowledge"|doc:oib_knowledge:';
