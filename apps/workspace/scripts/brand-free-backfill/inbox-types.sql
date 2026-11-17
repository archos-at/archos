-- drop after release 2026-W50: ADR-0182 phase 4, deploy 2, step 1.
-- The six agent inbox types piloti.* become agent.*, with the front of their
-- group key, so the next announcement folds into the row (as 0165 did).
-- A row whose agent.* twin already exists (written by a switched pod) folds into
-- that twin: the twin keeps its own state, adds the old row's count, and keeps
-- the earlier created_at; the old row is deleted. Run as the database owner
-- after the writer switch is live. Idempotent.

BEGIN;
UPDATE inbox_items AS a
   SET count = a.count + p.count,
       created_at = least(a.created_at, p.created_at)
  FROM inbox_items AS p
 WHERE p.type LIKE 'piloti.%'
   AND a.recipient_user_id = p.recipient_user_id
   AND a.group_key = 'agent.' || substr(p.group_key, 8);
DELETE FROM inbox_items AS p
 USING inbox_items AS a
 WHERE p.type LIKE 'piloti.%'
   AND a.recipient_user_id = p.recipient_user_id
   AND a.group_key = 'agent.' || substr(p.group_key, 8);
UPDATE inbox_items
   SET type = 'agent.' || substr(type, 8),
       group_key = CASE WHEN group_key LIKE 'piloti.%' THEN 'agent.' || substr(group_key, 8) ELSE group_key END
 WHERE type IN ('piloti.work_done', 'piloti.work_failed', 'piloti.asks_you',
                'piloti.proposal_waiting', 'piloti.intake_ready', 'piloti.revision_checked');
COMMIT;
