-- 0268: a chat's side is fixed in the database (ADR-0193; the owner's report of 2026-11-24).
--
-- A chat belongs to one side for its whole life: a project (`project_id`) or
-- Persönlich (`project_id IS NULL`, `started_in_personal`). The application
-- never changes it, and every guard above (the page redirect, the turn's
-- scope from the row, restricted use from the row) trusts that. This makes it
-- a fact of the database, so no faulty write can move a chat, or a message of
-- it, to the other side:
--
--   - `conversations`: `organization_id`, `project_id`, `started_in_personal`
--     and `created_by` are set once, at insert, and an UPDATE that changes one
--     is refused (GSD01). Deleting a project still cascades to its chats.
--   - a chat started in Persönlich has no project (CHECK, NOT VALID: it binds
--     every new or changed row without failing the deploy on an unchecked one).
--
-- That a chat's project is one of its own office the tenant policy already
-- holds (0031: a row must name a project of `current_org()`).
--   - `messages`: a message stays in the chat it was written in (GSD01).
--
-- Idempotent: functions are replaced, triggers and the constraint dropped and
-- created by name.
CREATE OR REPLACE FUNCTION conversation_side_is_fixed() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.started_in_personal IS DISTINCT FROM OLD.started_in_personal
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'conversation %: its office, project, side and creator are fixed', OLD.id
      USING ERRCODE = 'GSD01';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS conversation_side_is_fixed ON "conversations";
--> statement-breakpoint
CREATE TRIGGER conversation_side_is_fixed
  BEFORE UPDATE OF organization_id, project_id, started_in_personal, created_by ON "conversations"
  FOR EACH ROW EXECUTE FUNCTION conversation_side_is_fixed();
--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_personal_has_no_project";
--> statement-breakpoint
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_personal_has_no_project"
  CHECK (NOT "started_in_personal" OR "project_id" IS NULL) NOT VALID;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION message_stays_in_its_conversation() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id THEN
    RAISE EXCEPTION 'message %: it stays in the conversation it was written in', OLD.id
      USING ERRCODE = 'GSD01';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS message_stays_in_its_conversation ON "messages";
--> statement-breakpoint
CREATE TRIGGER message_stays_in_its_conversation
  BEFORE UPDATE OF conversation_id ON "messages"
  FOR EACH ROW EXECUTE FUNCTION message_stays_in_its_conversation();
