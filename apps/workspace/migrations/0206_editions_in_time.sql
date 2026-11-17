-- 0206: editions in time: an amending edition's transition, and how far back a
-- work's history is held (ADR-0171, design §3.4 and §3.6, ticket 30).
--
-- ## What was missing
--
-- An architect is judged by the law in force when the submission was filed,
-- not today's. Editions carried their in-force dates (0202), but nothing said
-- which procedures an amendment reaches (Übergangsbestimmungen) or from which
-- day the platform holds a work's history, so an answer for an older procedure
-- could only take the newest edition or the oldest one it happened to hold.
--
-- ## The shape
--
-- - `knowledge_edition_revisions.transition`: the transitional rule of an
--   amending edition, a `decision_table.v1` (ADR-0166) whose output is
--   `old_law`, `new_law` or `choice`. The wire's zod schema and the table's own
--   examples check it before a write (KC-5); the SQL holds that it is an
--   object or absent. An edition without one leaves its boundary to the
--   node's reference-date rule.
-- - `knowledge_work_revisions.history_available_from`: the first day whose
--   edition the platform holds. Before it the answer is `history_not_held`,
--   never the oldest edition present. Null means only the editions present.
--
-- The reference-date rules themselves are rulesets with purpose
-- `reference_date` (0204); platform ones arrive through change requests (0205).
--
-- ## RLS
--
-- Columns on tables that already carry their policies (0202, 0205); revisions
-- stay append-only, so a transition changes by a new revision, released like
-- any other.
ALTER TABLE "knowledge_edition_revisions" ADD COLUMN IF NOT EXISTS "transition" jsonb;
--> statement-breakpoint
ALTER TABLE "knowledge_edition_revisions" DROP CONSTRAINT IF EXISTS knowledge_edition_revisions_transition_object;
--> statement-breakpoint
ALTER TABLE "knowledge_edition_revisions" ADD CONSTRAINT knowledge_edition_revisions_transition_object
  CHECK ("transition" IS NULL OR jsonb_typeof("transition") = 'object');
--> statement-breakpoint
ALTER TABLE "knowledge_work_revisions" ADD COLUMN IF NOT EXISTS "history_available_from" date;
