-- drop after release 2026-W50: ADR-0182 phase 4, deploy 2, step 1. Read-only.
-- The stored mentions whose target is 'agent:piloti', per column: 0 on every
-- row once apply.sql has run.

SELECT store, rows FROM (
  SELECT 1 AS n, 'document_annotations.mentions' AS store, count(*) AS rows
    FROM document_annotations WHERE mentions::text LIKE '%"targetId": "agent:piloti"%'
  UNION ALL SELECT 2, 'document_annotation_replies.mentions', count(*)
    FROM document_annotation_replies WHERE mentions::text LIKE '%"targetId": "agent:piloti"%'
  UNION ALL SELECT 3, 'inbox_items.payload', count(*)
    FROM inbox_items WHERE payload::text LIKE '%"targetId": "agent:piloti"%'
  UNION ALL SELECT 4, 'messages.metadata', count(*)
    FROM messages WHERE metadata::text LIKE '%"targetId": "agent:piloti"%'
) AS counts ORDER BY n;
