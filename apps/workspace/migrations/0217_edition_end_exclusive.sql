-- An edition's `in_force_to` becomes the first day it no longer holds
-- (ADR-0171, amended): the half-open interval every other dated row in base
-- knowledge already reads (relations, territories, rulesets, 0211). Until now
-- it was the last day in force, so "which edition on a day" was answered three
-- ways and the chain resolver dropped a law on its edition's last day.
--
-- - Every stored end moves one day later, so each edition holds exactly the
--   days it held before. Revisions are append-only; the trigger is lifted for
--   this one rewrite and put back, as 0212's down migration does.
-- - An edition ending on the day it begins is in force on no day: the order
--   check becomes strict. Every row satisfies it after the shift.
ALTER TABLE "knowledge_edition_revisions" DISABLE TRIGGER knowledge_edition_revisions_append_only;
--> statement-breakpoint
UPDATE "knowledge_edition_revisions" SET "in_force_to" = "in_force_to" + 1 WHERE "in_force_to" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_edition_revisions" ENABLE TRIGGER knowledge_edition_revisions_append_only;
--> statement-breakpoint
ALTER TABLE "knowledge_edition_revisions" DROP CONSTRAINT IF EXISTS knowledge_edition_revisions_dates_ordered;
--> statement-breakpoint
ALTER TABLE "knowledge_edition_revisions" ADD CONSTRAINT knowledge_edition_revisions_dates_ordered CHECK (
  "in_force_to" IS NULL OR "in_force_from" IS NULL OR "in_force_to" > "in_force_from");
