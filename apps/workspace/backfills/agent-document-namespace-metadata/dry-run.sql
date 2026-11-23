-- drop after release 2026-W51: ADR-0182 phase 4, deploy 2, step 3. Read-only, jobs database.
-- The names apply.sql moves from piloti/ to generated/ in the backend's two metadata tables:
-- 0 on every row once it has run. A table the backend has not created yet counts 0.

SELECT store, rows FROM (
  SELECT 1 AS n, 'document_metadata.filename' AS store,
         CASE WHEN to_regclass('document_metadata') IS NULL THEN 0
              ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM document_metadata WHERE filename LIKE ''piloti/%''', false, true, '')))[1]::text::bigint
         END AS rows
  UNION ALL SELECT 2, 'document_metadata.superseded_by',
         CASE WHEN to_regclass('document_metadata') IS NULL THEN 0
              ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM document_metadata WHERE superseded_by LIKE ''piloti/%''', false, true, '')))[1]::text::bigint
         END
  UNION ALL SELECT 3, 'document_metadata.revision_suggestion',
         CASE WHEN to_regclass('document_metadata') IS NULL THEN 0
              ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM document_metadata WHERE revision_suggestion LIKE ''%"piloti/%''', false, true, '')))[1]::text::bigint
         END
  UNION ALL SELECT 4, 'document_revision_retained.filename',
         CASE WHEN to_regclass('document_revision_retained') IS NULL THEN 0
              ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM document_revision_retained WHERE filename LIKE ''piloti/%''', false, true, '')))[1]::text::bigint
         END
  UNION ALL SELECT 5, 'document_revision_retained.superseded_by',
         CASE WHEN to_regclass('document_revision_retained') IS NULL THEN 0
              ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM document_revision_retained WHERE superseded_by LIKE ''piloti/%''', false, true, '')))[1]::text::bigint
         END
  UNION ALL SELECT 6, 'document_revision_retained.revision_suggestion',
         CASE WHEN to_regclass('document_revision_retained') IS NULL THEN 0
              ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM document_revision_retained WHERE revision_suggestion LIKE ''%"piloti/%''', false, true, '')))[1]::text::bigint
         END
) AS counts ORDER BY n;
