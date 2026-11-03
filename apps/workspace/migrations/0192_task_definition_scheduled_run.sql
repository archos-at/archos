-- 0192: a definition remembers the Hatchet scheduled run that fires it next.
--
-- The scheduler container that claimed due rows every 30 s is gone (ADR-0150):
-- each enabled definition with a `next_run_at` now has exactly one Hatchet
-- scheduled run at that time, created, replaced or deleted whenever the
-- definition is saved, paused or deleted (`bff/scheduling/scheduled-runs.ts`).
-- To replace or delete it, the definition has to know its id.
--
-- Nullable, with no default and no backfill: NULL means "no scheduled run is
-- known", which is true of every row before the first deploy. The repair sweep
-- (`schedule-repair`) gives an overdue row its run, so existing schedules catch
-- up on their own after the cutover, without a one-shot script.
--
-- `next_run_at` stays the source of truth for when a definition is due, and
-- `idx_task_definitions_due` keeps backing the repair sweep's scan.

ALTER TABLE "task_definitions" ADD COLUMN IF NOT EXISTS "scheduled_run_id" text;
