-- drop after release 2026-W51: ADR-0182 phase 4, deploy 2, step 3. Read-only, app database.
-- The names apply.sql moves from piloti/ to generated/: 0 on every row once it has run.

SELECT store, rows FROM (
  SELECT 1 AS n, 'documents.filename of an agent_document' AS store, count(*) AS rows
    FROM documents WHERE filename LIKE 'piloti/%' AND authored_by_producer = 'agent_document'
  UNION ALL SELECT 2, 'permit_records.file_name', count(*)
    FROM permit_records WHERE file_name LIKE 'piloti/%'
  UNION ALL SELECT 3, 'document_quarantine_decisions.filename', count(*)
    FROM document_quarantine_decisions WHERE filename LIKE 'piloti/%'
) AS counts ORDER BY n;
