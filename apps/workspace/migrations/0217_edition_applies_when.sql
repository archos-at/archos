-- 0217: an edition's scope (ADR-0177, design §3.4): which buildings it is
-- written for, as a `decision_table.v1` over the building facts with a
-- boolean output, on the edition revision beside its `transition` (0206).
-- The chain runs it per building, so OIB-RL 2.1 is named for a Betriebsbau
-- and not for a block of flats. The wire's zod schema and the table's own
-- examples check it before a write (KC-5); the SQL holds that it is an object
-- or absent. Absent applies to every building, as before.
--
-- A column on a table that already carries its policies (0202, 0205);
-- revisions stay append-only, so a scope changes by a new revision.
ALTER TABLE "knowledge_edition_revisions" ADD COLUMN IF NOT EXISTS "applies_when" jsonb;
--> statement-breakpoint
ALTER TABLE "knowledge_edition_revisions" ADD CONSTRAINT knowledge_edition_revisions_applies_when_object
  CHECK ("applies_when" IS NULL OR jsonb_typeof("applies_when") = 'object');
