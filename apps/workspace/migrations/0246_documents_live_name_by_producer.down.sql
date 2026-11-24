-- Reverse 0246: the live-name rule reads the filename prefix again, as 0243 defined it.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'uniq_documents_live_name_per_collection'
       AND indexdef LIKE '%generated/%'
  ) THEN
    DROP INDEX IF EXISTS "uniq_documents_live_name_per_collection";
    CREATE UNIQUE INDEX "uniq_documents_live_name_per_collection"
      ON "documents" ("organization_id", "collection_name", "filename")
      WHERE "authored_by" = 'user' OR "filename" LIKE 'piloti/%' OR "filename" LIKE 'generated/%';
    COMMENT ON INDEX "uniq_documents_live_name_per_collection" IS
      'One live document per (organization, collection, filename) over every row that can own chunks: the ingest pipeline replaces passages by filename, so a second row under one name is a ghost. Three disjoint arms. authored_by = ''user'' is migration 0074''s rule, the WHERE clause of findLiveDocumentByFilename. filename LIKE ''piloti/%'' (0083) and filename LIKE ''generated/%'' (0243) are the namespace an agent-authored document is filed under when it may be published and indexed (ADR-0054, ADR-0149); no browser produces a filename containing a slash, so no upload reaches those arms. A machine-authored row outside the namespaces is in no arm.';
  END IF;
END $$;
