-- 0193: a third PostHog export stream, the ledger summed per outcome.
--
-- `llm_usage_hourly` sums the ledger per organization, hour, model and purpose,
-- so it answers "what did we spend" and never "what did one answer, one
-- document, one task cost": the `message_id`, `job_id` and `conversation_id`
-- every ledger row carries are summed away. `llm_usage_by_outcome`
-- (`bff/analytics/usage-export.ts`) sends the same rows grouped by those keys
-- instead, so PostHog joins a cost to `answer_completed` (by `message_id`) and
-- to `document_ingest_started` / `document_ingest_finished` (by `job_id`).
-- Its cursor starts at the backfill horizon like the hourly stream's, so the
-- history arrives with the first runs. Only the CHECK changes.

ALTER TABLE "analytics_export_cursors" DROP CONSTRAINT IF EXISTS "analytics_export_cursors_stream_known";
--> statement-breakpoint
ALTER TABLE "analytics_export_cursors" ADD CONSTRAINT "analytics_export_cursors_stream_known"
  CHECK ("stream" IN ('posthog_usage_hourly', 'posthog_budget_snapshot', 'posthog_usage_by_outcome'));
