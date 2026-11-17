-- Reverse 0206. ORDER: roll the frontend back first; the newer build reads and
-- writes both columns.
--
-- Lossy: every transition and history date goes. Answers for a procedure then
-- read no transition, which the newer build would refuse to guess; the older
-- build does not answer by procedure at all.
ALTER TABLE "knowledge_edition_revisions" DROP CONSTRAINT IF EXISTS knowledge_edition_revisions_transition_object;
ALTER TABLE "knowledge_edition_revisions" DROP COLUMN IF EXISTS "transition";
ALTER TABLE "knowledge_work_revisions" DROP COLUMN IF EXISTS "history_available_from";
