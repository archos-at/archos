-- Reverse 0216. ORDER: roll the frontend back first; the newer build writes
-- and reads `in_force_to` as the first day no longer in force.
--
-- Lossless: every end moves back one day, to the last day in force.
ALTER TABLE "knowledge_edition_revisions" DROP CONSTRAINT IF EXISTS knowledge_edition_revisions_dates_ordered;
ALTER TABLE "knowledge_edition_revisions" DISABLE TRIGGER knowledge_edition_revisions_append_only;
UPDATE "knowledge_edition_revisions" SET "in_force_to" = "in_force_to" - 1 WHERE "in_force_to" IS NOT NULL;
ALTER TABLE "knowledge_edition_revisions" ENABLE TRIGGER knowledge_edition_revisions_append_only;
ALTER TABLE "knowledge_edition_revisions" ADD CONSTRAINT knowledge_edition_revisions_dates_ordered CHECK (
  "in_force_to" IS NULL OR "in_force_from" IS NULL OR "in_force_to" >= "in_force_from");
