-- Reverse 0243: the live-name index returns to 0083's two arms. No row is
-- renamed here. A row still under `generated/` leaves the guard, which is the
-- state before 0243 for any such row; run it after the backfill has been
-- reversed, or those rows keep their names and lose the guard.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'uniq_documents_live_name_per_collection'
       AND indexdef LIKE '%generated/%'
  ) THEN
    DROP INDEX "uniq_documents_live_name_per_collection";
    CREATE UNIQUE INDEX "uniq_documents_live_name_per_collection"
      ON "documents" ("organization_id", "collection_name", "filename")
      WHERE "authored_by" = 'user' OR "filename" LIKE 'piloti/%';
    COMMENT ON INDEX "uniq_documents_live_name_per_collection" IS
      'One live document per (organization, collection, filename) over every row that can own chunks: the ingest pipeline replaces passages by filename, so a second row under one name is a ghost that is listed and downloadable but findable by nothing. Two disjoint arms. authored_by = ''user'' is migration 0074''s original rule and is exactly the WHERE clause of findLiveDocumentByFilename, the probe that makes a re-upload replace instead of insert; this index closes the concurrent-first-upload race the probe cannot. filename LIKE ''piloti/%'' covers the namespace an agent-authored document is filed under when a version of it may be published and therefore indexed (ADR-0054, migration 0083) — no browser produces a filename containing a slash, so no upload can reach that arm and the two cannot collide. A machine-authored row OUTSIDE the namespace is in neither arm: it carries a model-chosen name, owns no chunks, and must coexist with a person''s file of the same name.';
  END IF;
END $$;
