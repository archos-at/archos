-- Reverse 0246: the rollup forgets the ingest share of a day, and ingestion
-- counts against the daily and monthly limits again.
--
-- ORDER: roll the frontend back first; the newer build writes the columns.
ALTER TABLE "llm_usage_rollups" DROP COLUMN IF EXISTS "ingest_events";
--> statement-breakpoint
ALTER TABLE "llm_usage_rollups" DROP COLUMN IF EXISTS "ingest_tokens";
--> statement-breakpoint
ALTER TABLE "llm_usage_rollups" DROP COLUMN IF EXISTS "ingest_credits";
