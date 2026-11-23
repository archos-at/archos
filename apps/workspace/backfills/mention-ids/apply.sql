-- drop after release 2026-W50: ADR-0182 phase 4, deploy 2, step 1.
-- The agent's mention id 'agent:piloti' becomes 'agent:core' wherever a stored
-- mention names it as its target: document_annotations.mentions,
-- document_annotation_replies.mentions, inbox_items.payload and
-- messages.metadata. Only a "targetId" key is rewritten; an "@" inside free text
-- stays, and readers keep accepting it. Run as the database owner after the
-- writer switch is live, outside a transaction (each batch commits). Idempotent.

DO $$
DECLARE moved integer;
BEGIN
  LOOP
    UPDATE document_annotations
       SET mentions = replace(mentions::text, '"targetId": "agent:piloti"', '"targetId": "agent:core"')::jsonb
     WHERE id IN (SELECT id FROM document_annotations
                   WHERE mentions::text LIKE '%"targetId": "agent:piloti"%' LIMIT 1000);
    GET DIAGNOSTICS moved = ROW_COUNT;
    COMMIT;
    EXIT WHEN moved = 0;
  END LOOP;
  LOOP
    UPDATE document_annotation_replies
       SET mentions = replace(mentions::text, '"targetId": "agent:piloti"', '"targetId": "agent:core"')::jsonb
     WHERE id IN (SELECT id FROM document_annotation_replies
                   WHERE mentions::text LIKE '%"targetId": "agent:piloti"%' LIMIT 1000);
    GET DIAGNOSTICS moved = ROW_COUNT;
    COMMIT;
    EXIT WHEN moved = 0;
  END LOOP;
  LOOP
    UPDATE inbox_items
       SET payload = replace(payload::text, '"targetId": "agent:piloti"', '"targetId": "agent:core"')::jsonb
     WHERE id IN (SELECT id FROM inbox_items
                   WHERE payload::text LIKE '%"targetId": "agent:piloti"%' LIMIT 1000);
    GET DIAGNOSTICS moved = ROW_COUNT;
    COMMIT;
    EXIT WHEN moved = 0;
  END LOOP;
  LOOP
    UPDATE messages
       SET metadata = replace(metadata::text, '"targetId": "agent:piloti"', '"targetId": "agent:core"')::jsonb
     WHERE id IN (SELECT id FROM messages
                   WHERE metadata::text LIKE '%"targetId": "agent:piloti"%' LIMIT 1000);
    GET DIAGNOSTICS moved = ROW_COUNT;
    COMMIT;
    EXIT WHEN moved = 0;
  END LOOP;
END
$$;
