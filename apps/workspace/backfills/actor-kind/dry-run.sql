-- drop after release 2026-W50: ADR-0182 phase 4, deploy 2, step 1. Read-only.
-- The rows apply.sql rewrites, per column: 0 on every row once it has run.

SELECT store, rows FROM (
  SELECT 1 AS n, 'document_annotations.author_kind' AS store, count(*) AS rows
    FROM document_annotations WHERE author_kind = 'piloti'
  UNION ALL SELECT 2, 'document_annotation_replies.author_kind', count(*)
    FROM document_annotation_replies WHERE author_kind = 'piloti'
  UNION ALL SELECT 3, 'proposed_changes.proposed_by_kind', count(*)
    FROM proposed_changes WHERE proposed_by_kind = 'piloti'
) AS counts ORDER BY n;
