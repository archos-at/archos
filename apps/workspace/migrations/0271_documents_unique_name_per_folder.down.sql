-- Reverse 0271: one live document per (organization, collection, filename) again, as 0246 defined it.

DO $$
DECLARE
  duplicates text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'uniq_documents_live_name_per_collection'
       AND indexdef ILIKE '%normalize(%'
  ) THEN
    SELECT string_agg(entry, E'\n  ' ORDER BY entry) INTO duplicates
    FROM (
      SELECT format(
               'organization %s, collection %s, name %L (%s documents, in folders %s)',
               "organization_id",
               "collection_name",
               "filename",
               count(*),
               string_agg(coalesce("folder_id", '00000000-0000-0000-0000-000000000000'::uuid)::text, ', ' ORDER BY "folder_id" NULLS FIRST)
             ) AS entry
      FROM "documents"
      WHERE "authored_by" = 'user' OR "authored_by_producer" IN ('agent_document', 'agent_file')
      GROUP BY "organization_id", "collection_name", "filename"
      HAVING count(*) > 1
    ) AS dupes;

    IF duplicates IS NOT NULL THEN
      RAISE EXCEPTION E'Cannot reverse migration 0271: one collection already holds live documents of the same name in different folders, so the per-collection name index of 0246 cannot be built.\n  %\nRename all but one of each through the application first. This rollback deliberately does not deduplicate them: each is a document of its own, with its own Fassungen, facts and citations.',
        duplicates;
    END IF;

    DROP INDEX IF EXISTS "uniq_documents_live_name_per_collection";
    CREATE UNIQUE INDEX "uniq_documents_live_name_per_collection"
      ON "documents" ("organization_id", "collection_name", "filename")
      WHERE "authored_by" = 'user' OR "authored_by_producer" IN ('agent_document', 'agent_file');
    COMMENT ON INDEX "uniq_documents_live_name_per_collection" IS
      'A document''s identity is documents.id; its filename is a label. One live document per (organization, collection, filename), case- and folder-blind: 0246''s key, which 0271 widened to the folder and its down restores. Two arms. authored_by = ''user'' is migration 0074''s rule. authored_by_producer IN (''agent_document'', ''agent_file'') (0246) are the machine producers whose documents may be published and indexed (ADR-0054, ADR-0182).';
  END IF;
END $$;
