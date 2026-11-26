-- 0271: a document's name is unique within its folder, not its collection. Identity is
-- documents.id; the name is the label a folder shows, compared as the Finder compares it:
-- NFC-normalized, trimmed, case-insensitive. The project root is a folder of its own (a NULL
-- folder_id keys as the nil UUID, as uniq_project_folders_parent_name does since 0063). Same rows
-- as 0246 (its predicate is unchanged); only the key widens to the folder and narrows to the
-- comparison key.

DO $$
DECLARE
  duplicates text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'uniq_documents_live_name_per_collection'
       AND indexdef LIKE '%folder_id%'
       AND indexdef ILIKE '%normalize(%'
  ) THEN
    SELECT string_agg(entry, E'\n  ' ORDER BY entry) INTO duplicates
    FROM (
      SELECT format(
               'organization %s, collection %s, folder %s, names %s (%s documents)',
               "organization_id",
               "collection_name",
               coalesce("folder_id", '00000000-0000-0000-0000-000000000000'::uuid),
               string_agg(format('%L', "filename"), ', ' ORDER BY "filename"),
               count(*)
             ) AS entry
      FROM "documents"
      WHERE "authored_by" = 'user' OR "authored_by_producer" IN ('agent_document', 'agent_file')
      GROUP BY
        "organization_id",
        "collection_name",
        coalesce("folder_id", '00000000-0000-0000-0000-000000000000'::uuid),
        lower(normalize(btrim("filename"), NFC))
      HAVING count(*) > 1
    ) AS dupes;

    IF duplicates IS NOT NULL THEN
      RAISE EXCEPTION E'Cannot apply migration 0271: a folder already holds two live documents whose names differ only in case, Unicode normalization or surrounding whitespace, so the per-folder name index cannot be built.\n  %\nResolve each one first by renaming or moving one of the documents through the application, so its Fassungen, facts and citations move with the decision. This migration deliberately does not deduplicate them: deleting or renaming a document row here would orphan its chunks and versions and silently change what a person sees.',
        duplicates;
    END IF;

    DROP INDEX IF EXISTS "uniq_documents_live_name_per_collection";
    CREATE UNIQUE INDEX "uniq_documents_live_name_per_collection"
      ON "documents" (
        "organization_id",
        "collection_name",
        (coalesce("folder_id", '00000000-0000-0000-0000-000000000000'::uuid)),
        (lower(normalize(btrim("filename"), NFC)))
      )
      WHERE "authored_by" = 'user' OR "authored_by_producer" IN ('agent_document', 'agent_file');
    COMMENT ON INDEX "uniq_documents_live_name_per_collection" IS
      'A document''s identity is documents.id; its filename is a label, unique within its folder. One live document per (organization, collection, folder, name), the name compared as lower(normalize(btrim(filename), NFC)): trimmed, NFC-normalized, case-folded as the database''s LC_CTYPE folds it. Production runs under C, which folds ASCII letters only: Plan.pdf and plan.pdf collide here, Änderung.pdf and änderung.pdf do not. The BFF''s documentNameMatchKey folds all of Unicode and refuses both first; this index is the backstop for a race. COALESCE to the nil UUID over folder_id because NULL never equals NULL in a unique index, which would leave the project root uncontrolled; a shelf without folders (a conversation''s attachments) keeps one document per name. Two arms, as 0246: authored_by = ''user'', and authored_by_producer IN (''agent_document'', ''agent_file''), the machine producers whose documents may be published and indexed (ADR-0054, ADR-0182). It exists so two uploads racing into one folder cannot both win; the ingest pipeline, the vector store and the citations address a document by its id, never by this name (0271).';
  END IF;
END $$;
