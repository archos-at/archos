-- Undo 0270. ORDER: roll the backend back first; the older build reads only the
-- old name.
--
-- Not lossy: the same exact tokens are written back.
UPDATE "messages"
SET "metadata" = replace(replace("metadata"::text, 'doc:base_corpus:', 'doc:oib_knowledge:'), '"base_corpus"', '"oib_knowledge"')::jsonb
WHERE "metadata"::text ~ '"base_corpus"|doc:base_corpus:';
--> statement-breakpoint
UPDATE "citation_events"
SET "detail" = replace(replace("detail"::text, 'doc:base_corpus:', 'doc:oib_knowledge:'), '"base_corpus"', '"oib_knowledge"')::jsonb
WHERE "detail"::text ~ '"base_corpus"|doc:base_corpus:';
