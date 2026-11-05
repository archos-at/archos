-- Reverse 0193: drop the outcome stream's cursor, then narrow the CHECK again.

DELETE FROM "analytics_export_cursors" WHERE "stream" = 'posthog_usage_by_outcome';
--> statement-breakpoint
ALTER TABLE "analytics_export_cursors" DROP CONSTRAINT IF EXISTS "analytics_export_cursors_stream_known";
--> statement-breakpoint
ALTER TABLE "analytics_export_cursors" ADD CONSTRAINT "analytics_export_cursors_stream_known"
  CHECK ("stream" IN ('posthog_usage_hourly', 'posthog_budget_snapshot'));
