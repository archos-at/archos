-- drop after release 2026-W50: ADR-0182 phase 4, deploy 2, step 1. Read-only.
-- The stored lane 'office_piloti', as a value in messages.metadata and as a key
-- of citation_events.detail.lanes: 0 on both rows once apply.sql has run.

SELECT store, rows FROM (
  SELECT 1 AS n, 'messages.metadata' AS store, count(*) AS rows
    FROM messages WHERE metadata::text ~ '"office_piloti"(?!:)'
  UNION ALL SELECT 2, 'citation_events.detail.lanes', count(*)
    FROM citation_events WHERE jsonb_typeof(detail -> 'lanes') = 'object' AND detail -> 'lanes' ? 'office_piloti'
) AS counts ORDER BY n;
