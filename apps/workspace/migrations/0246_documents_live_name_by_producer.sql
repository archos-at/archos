-- 0246 (ADR-0182 phase 4, step 3): an agent document joins the live-name rule by its producer,
-- not by the `piloti/` or `generated/` prefix, so the namespace can be renamed under it. The two
-- producers that file under the namespace are exactly the rows the prefix held (dev, prod, 2026-11-18).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'uniq_documents_live_name_per_collection'
       AND indexdef LIKE '%authored_by_producer%'
  ) THEN
    DROP INDEX IF EXISTS "uniq_documents_live_name_per_collection";
    CREATE UNIQUE INDEX "uniq_documents_live_name_per_collection"
      ON "documents" ("organization_id", "collection_name", "filename")
      WHERE "authored_by" = 'user' OR "authored_by_producer" IN ('agent_document', 'agent_file');
    COMMENT ON INDEX "uniq_documents_live_name_per_collection" IS
      'One live document per (organization, collection, filename) over every row that can own chunks: the ingest pipeline replaces passages by filename, so a second row under one name is a ghost. Two arms. authored_by = ''user'' is migration 0074''s rule, the WHERE clause of findLiveDocumentByFilename. authored_by_producer IN (''agent_document'', ''agent_file'') (0246) are the machine producers whose documents may be published and indexed (ADR-0054, ADR-0182); it replaces the filename-prefix arms of 0083 and 0243.';
  END IF;
END $$;
