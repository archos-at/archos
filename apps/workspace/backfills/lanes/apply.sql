-- drop after release 2026-W50: ADR-0182 phase 4, deploy 2, step 1.
-- The agent-authored lane 'office_piloti' becomes 'office_agent' where it is
-- stored: as a value anywhere in messages.metadata (citation sources, trace
-- lanes, the retrieval ledger), and as a key of citation_events.detail.lanes,
-- whose count is added to an existing 'office_agent' count. Run as the database
-- owner after the writer switch is live, outside a transaction (each batch
-- commits). Idempotent.

DO $$
DECLARE moved integer;
BEGIN
  LOOP
    UPDATE messages
       SET metadata = regexp_replace(metadata::text, '"office_piloti"(?!:)', '"office_agent"', 'g')::jsonb
     WHERE id IN (SELECT id FROM messages
                   WHERE metadata::text ~ '"office_piloti"(?!:)' LIMIT 1000);
    GET DIAGNOSTICS moved = ROW_COUNT;
    COMMIT;
    EXIT WHEN moved = 0;
  END LOOP;
  LOOP
    UPDATE citation_events AS e
       SET detail = jsonb_set(e.detail, '{lanes}', (
             SELECT jsonb_object_agg(lane, total)
               FROM (SELECT CASE WHEN key = 'office_piloti' THEN 'office_agent' ELSE key END AS lane,
                            to_jsonb(sum((value #>> '{}')::numeric)) AS total
                       FROM jsonb_each(e.detail -> 'lanes')
                      GROUP BY 1) AS merged))
     WHERE e.id IN (SELECT id FROM citation_events
                     WHERE jsonb_typeof(detail -> 'lanes') = 'object'
                       AND detail -> 'lanes' ? 'office_piloti' LIMIT 1000);
    GET DIAGNOSTICS moved = ROW_COUNT;
    COMMIT;
    EXIT WHEN moved = 0;
  END LOOP;
END
$$;
