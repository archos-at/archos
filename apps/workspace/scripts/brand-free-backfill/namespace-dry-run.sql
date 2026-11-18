-- drop after release 2026-W51: ADR-0182 phase 4, deploy 2, step 3. Read-only, app database.
-- Counts what namespace.sql renames. Run as the database owner:
--   psql "$OWNER_URL" -f apps/workspace/scripts/brand-free-backfill/namespace-dry-run.sql
-- After the backfill every count is 0 except the generated/ row.

SELECT store, rows FROM (
  SELECT 1 AS n, 'documents: agent_document under piloti/' AS store, count(*) AS rows
    FROM documents WHERE filename LIKE 'piloti/%' AND authored_by_producer = 'agent_document'
  UNION ALL SELECT 2, 'documents: piloti/ of any other producer (must be 0)', count(*)
    FROM documents WHERE filename LIKE 'piloti/%' AND authored_by_producer IS DISTINCT FROM 'agent_document'
  UNION ALL SELECT 3, 'documents: under generated/', count(*)
    FROM documents WHERE filename LIKE 'generated/%'
  UNION ALL SELECT 4, 'permit_records.file_name under piloti/', count(*)
    FROM permit_records WHERE file_name LIKE 'piloti/%'
  UNION ALL SELECT 5, 'document_quarantine_decisions.filename under piloti/', count(*)
    FROM document_quarantine_decisions WHERE filename LIKE 'piloti/%'
) AS counts ORDER BY n;
