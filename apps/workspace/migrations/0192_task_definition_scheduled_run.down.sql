-- Reverse 0192. The Hatchet scheduled runs the column named are not deleted
-- here: a fire whose definition no longer holds that due time records nothing
-- (`advanceDueDefinition`), so an orphaned run is harmless.

ALTER TABLE "task_definitions" DROP COLUMN IF EXISTS "scheduled_run_id";
