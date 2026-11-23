-- 0247: the daily rollup knows how much of a day was reading documents in.
--
-- An office that sets a project up uploads its whole folder at once. Indexing
-- it (OCR, vision, embeddings) was booked into the same rollup the daily and
-- monthly limits read, so the upload spent the day's allowance and the first
-- question was refused (KAN-53). Ingestion now has an allowance of its own:
-- the rollup keeps its ingest share beside the totals, the limits compare the
-- rest, and the ingest share is compared against its own ceiling.
--
-- `credits`, `tokens` and `events` stay the totals of the day, so nothing that
-- sums them changes. The three new columns are the part of each that came from
-- `activity = 'ingest'` ledger rows.
--
-- The backfill makes the month already running right: without it an upload
-- from before this deploy would keep counting against the limits until the
-- 1st. An ingest row the old build books between this migration and its own
-- replacement lands in the totals only, and counts as work for that month.
ALTER TABLE "llm_usage_rollups" ADD COLUMN IF NOT EXISTS "ingest_credits" numeric(14, 6) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "llm_usage_rollups" ADD COLUMN IF NOT EXISTS "ingest_tokens" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "llm_usage_rollups" ADD COLUMN IF NOT EXISTS "ingest_events" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "llm_usage_rollups" AS r
SET "ingest_credits" = e.credits,
    "ingest_tokens" = e.tokens,
    "ingest_events" = e.events
FROM (
  SELECT "organization_id",
         ("created_at" AT TIME ZONE 'UTC')::date AS day,
         coalesce("user_id", '') AS user_id,
         coalesce("project_id", '') AS project_id,
         sum("credits") AS credits,
         sum("total_tokens") AS tokens,
         count(*) AS events
  FROM "llm_usage_events"
  WHERE "activity" = 'ingest'
  GROUP BY 1, 2, 3, 4
) AS e
WHERE r."organization_id" = e."organization_id"
  AND r."day" = e.day
  AND r."user_id" = e.user_id
  AND r."project_id" = e.project_id;
