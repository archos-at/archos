-- drop after release 2026-W50: ADR-0182 phase 4, deploy 2, step 1. Read-only.
-- Counts what each step-1 backfill would rewrite. Run as the database owner:
--   psql "$OWNER_URL" -f apps/workspace/scripts/brand-free-backfill/dry-run.sql
-- Every count but the twins is 0 once the backfills and their sweep have run.

SELECT store, rows FROM (
  SELECT 1 AS n, 'actor kind: document_annotations.author_kind' AS store, count(*) AS rows
    FROM document_annotations WHERE author_kind = 'piloti'
  UNION ALL SELECT 2, 'actor kind: document_annotation_replies.author_kind', count(*)
    FROM document_annotation_replies WHERE author_kind = 'piloti'
  UNION ALL SELECT 3, 'actor kind: proposed_changes.proposed_by_kind', count(*)
    FROM proposed_changes WHERE proposed_by_kind = 'piloti'
  UNION ALL SELECT 4, 'inbox: rows of a piloti.* type', count(*)
    FROM inbox_items WHERE type LIKE 'piloti.%'
  UNION ALL SELECT 5, 'inbox: of those, rows whose agent.* twin exists (merged, not renamed)', count(*)
    FROM inbox_items p JOIN inbox_items a
      ON a.recipient_user_id = p.recipient_user_id AND a.group_key = 'agent.' || substr(p.group_key, 8)
   WHERE p.type LIKE 'piloti.%'
  UNION ALL SELECT 6, 'mention id: document_annotations.mentions', count(*)
    FROM document_annotations WHERE mentions::text LIKE '%"targetId": "agent:piloti"%'
  UNION ALL SELECT 7, 'mention id: document_annotation_replies.mentions', count(*)
    FROM document_annotation_replies WHERE mentions::text LIKE '%"targetId": "agent:piloti"%'
  UNION ALL SELECT 8, 'mention id: inbox_items.payload', count(*)
    FROM inbox_items WHERE payload::text LIKE '%"targetId": "agent:piloti"%'
  UNION ALL SELECT 9, 'mention id: messages.metadata', count(*)
    FROM messages WHERE metadata::text LIKE '%"targetId": "agent:piloti"%'
  UNION ALL SELECT 10, 'lane: messages.metadata', count(*)
    FROM messages WHERE metadata::text LIKE '%"office_piloti"%'
  UNION ALL SELECT 11, 'lane: citation_events.detail.lanes', count(*)
    FROM citation_events WHERE jsonb_typeof(detail -> 'lanes') = 'object' AND detail -> 'lanes' ? 'office_piloti'
) AS counts ORDER BY n;
