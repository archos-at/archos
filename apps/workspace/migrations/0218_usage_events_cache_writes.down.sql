-- Reverse 0218: forget how many tokens each call wrote to the prompt cache.
--
-- ORDER: roll the frontend back first; the newer build writes the column.
ALTER TABLE "llm_usage_events" DROP COLUMN IF EXISTS "cache_write_tokens";
