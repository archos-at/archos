-- Down for 0237. An index only; dropping it slows the expiry sweep's read and loses nothing.
DROP INDEX IF EXISTS "idx_agent_asks_open_created";
