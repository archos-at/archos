-- 0237: find the asks still open, oldest first, across every organization.
--
-- The `agent-ask-expiry` sweep (every five minutes, `endLostAsks`) ends the asks
-- whose turn never reported its end, by age (`findAsksOpenBefore`). The table's
-- indexes lead with the organization or the conversation, so that read scanned
-- every ask ever made. Partial, because nearly every row has ended: the index
-- holds only the asks a sweep can still end, and stays a handful of rows.
CREATE INDEX IF NOT EXISTS "idx_agent_asks_open_created" ON "agent_asks" ("created_at") WHERE "state" IN ('submitted', 'working');
