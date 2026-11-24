-- 0243: the live-name rule covers the `generated/` filename namespace beside
-- `piloti/` (EXPAND, ADR-0149: the document namespace `piloti/` becomes
-- `generated/`, what the agent wrote rather than who it is).
--
-- ## What this step does, and what it leaves for the backfill
--
-- The new prefix joins the old one: the index below accepts both, every reader
-- accepts both, and writers keep filing under `piloti/` until the owner signs
-- off the backfill. No row is renamed here, so no row carries `generated/` when
-- this runs. The rows, the vector payloads and the metadata table rename in one
-- step later, because the document namespace is the join key between a row and
-- its vectors and the purge deletes by it.
--
-- ## Why the index widens before any row moves
--
-- 0083 made the live-name index accept `piloti/`: a published agent document
-- owns chunks, and the ingest pipeline replaces passages by filename, so two
-- rows under one name would be a ghost. The same holds under `generated/`. The
-- arm is added beside the old one now, so the backfill renames rows into a
-- namespace the index already guards, and no collision can open between the
-- rename and a rebuild.
--
-- The arms stay disjoint by construction, as 0083 argues: no browser produces a
-- file whose name contains `/`, so no upload can reach either namespace arm.
--
-- ## No CHECK names the prefix
--
-- The only constraint that reads the prefix is this index (`grep` of the
-- migrations for the prefix finds 0083 and this file). Nothing else widens.
--
-- ## Locks
--
-- As 0074, 0077 and 0083: a plain CREATE UNIQUE INDEX takes a SHARE lock for the
-- build, and CONCURRENTLY cannot run inside the runner's transaction. No table
-- is added or removed, so the tenant boundary is untouched.
--
-- ## Idempotent
--
-- The index is rebuilt only while its definition does not yet name `generated/`.
-- A second run changes nothing.

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
