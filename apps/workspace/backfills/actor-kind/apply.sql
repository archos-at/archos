-- drop after release 2026-W50: ADR-0182 phase 4, deploy 2, step 1.
-- The agent's actor kind 'piloti' becomes 'agent' on the three columns 0242
-- widened. Run as the database owner after the writer switch is live, outside a
-- transaction (each batch commits). Idempotent: a second run changes nothing.

DO $$
DECLARE moved integer;
BEGIN
  LOOP
    UPDATE document_annotations SET author_kind = 'agent'
     WHERE id IN (SELECT id FROM document_annotations WHERE author_kind = 'piloti' LIMIT 1000);
    GET DIAGNOSTICS moved = ROW_COUNT;
    COMMIT;
    EXIT WHEN moved = 0;
  END LOOP;
  LOOP
    UPDATE document_annotation_replies SET author_kind = 'agent'
     WHERE id IN (SELECT id FROM document_annotation_replies WHERE author_kind = 'piloti' LIMIT 1000);
    GET DIAGNOSTICS moved = ROW_COUNT;
    COMMIT;
    EXIT WHEN moved = 0;
  END LOOP;
  LOOP
    UPDATE proposed_changes SET proposed_by_kind = 'agent'
     WHERE id IN (SELECT id FROM proposed_changes WHERE proposed_by_kind = 'piloti' LIMIT 1000);
    GET DIAGNOSTICS moved = ROW_COUNT;
    COMMIT;
    EXIT WHEN moved = 0;
  END LOOP;
END
$$;
