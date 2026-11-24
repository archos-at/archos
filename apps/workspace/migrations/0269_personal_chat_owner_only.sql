-- 0269: a personal chat is its owner's, and the people it is shared with
-- (ADR-0193, amendment „A personal chat is read by its owner“; the owner's
-- report of 2026-11-24).
--
-- A chat without a project (`conversations.project_id IS NULL`) was held only
-- by the organization's policy, so a query run for any colleague or an
-- administrator could read it, its messages and what it drew on, whatever the
-- application meant to show. As 0263 did for „Meine Ablage“, the database now
-- holds it, so no faulty query can show it to anyone else.
--
-- ## Who reads a personal chat
--
-- The policy on `conversations` adds, for a row without a project,
--
--   created_by = current_user_id()
--   OR a grant in resource_shares names the chat and current_user_id()
--   OR current_system_reader() IS NOT NULL
--
-- to the organization's. A visibility of `organization` does not open it to the
-- office: chats offer `private` and `project` only (`CONVERSATION_VISIBILITIES`),
-- so a personal chat reaches a colleague by a grant and by nothing else. A
-- context with no person matches none, unless it names itself a system reader
-- (`withSystemReader`, the `SYSTEM_READERS` registry in
-- `bff/db/tenant-context.ts`): the agent host writing an answer, the erasure,
-- the memory checks, and the document notices act for the chat, not for a
-- reader. A chat in a project keeps its policy unchanged.
--
-- ## What is hidden with it
--
-- Every table that holds a personal chat's content, its name or what it drew
-- on asks `personal_conversation_hidden` whether the chat is someone else's
-- personal one: `messages`, `conversation_reads`, `conversation_restricted_folders`,
-- `conversation_source_projects`, `message_restricted_use`, `answer_contexts`,
-- `agent_asks`, `answer_feedback` (the vote's comment and expected answer),
-- and a chat's own attachments: `documents` and `upload_batches` of scope
-- `session`, and through `personal_document_hidden` their versions, search rows
-- and annotations. The function reads past the conversations policy, so a row
-- naming a chat that does not exist (yet, or any more) still fails on its
-- foreign key, not on the policy.
--
-- These stay the organization's, as telemetry or as rows with an audience of
-- their own: `llm_usage_events` (the office's budget counts every chat),
-- `citation_events` and `agent_profiler_spans` (counts and timings, no text of
-- the chat), `message_edition_uses` (which edition an answer cited),
-- `proposed_changes` and `agent_changes` (addressed to the shelf or document
-- they change, which has its own policy), `project_memory` (written to be the
-- project's or the office's), `task_runs`, `inbox_items`, `mention_requests`
-- and `resource_shares` (each names the chat by id for the people it is
-- addressed to).
--
-- ## Grants
--
-- A grant on a personal chat is written only by someone who may read it: the
-- trigger `resource_shares_conversation_reachable` refuses an insert or an
-- update naming a chat hidden from the writer, before the new row could make it
-- readable to them. Removing a grant bumps the chat's audience version past the
-- policy (`conversation_audience_bump_past_policy`): a grantee leaving a chat
-- can no longer see it once their own grant is gone, and 0261's bump would have
-- matched nothing and been lost.
--
-- ## Restricted use of a revision thread
--
-- `mark_revision_thread` runs from triggers on documents, folders and task
-- runs, as whoever changed them, and marks a revision thread's messages. Run as
-- a colleague it would see none of someone else's personal thread and mark
-- nothing, so it now runs as its owner, as the marks are the chat's, never the
-- writer's.
--
-- Idempotent: functions are replaced whole, the trigger dropped and created by
-- name, and a policy is installed whole by `secure_table`.
CREATE OR REPLACE FUNCTION personal_conversation_hidden(conversation text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT current_system_reader() IS NULL AND EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = conversation AND c.organization_id = current_org() AND c.project_id IS NULL
      AND c.created_by IS DISTINCT FROM current_user_id()
      AND NOT EXISTS (
        SELECT 1 FROM resource_shares s
        WHERE s.resource_type = 'conversation' AND s.resource_id = c.id
          AND s.organization_id = c.organization_id AND s.subject_user_id = current_user_id()
      )
  )
$$;
--> statement-breakpoint
COMMENT ON FUNCTION personal_conversation_hidden(text) IS
  'True when the conversation is a chat without a project that the acting person neither created nor holds a grant on, and no system reader acts (ADR-0193). Reads past the conversations policy.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION personal_conversation_hidden(text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION personal_conversation_hidden(text) TO %I, %I', rls_role('rw'), rls_role('platform'));
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION personal_document_hidden(document uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = document AND d.organization_id = current_org()
      AND current_system_reader() IS NULL
      AND (
        (d.owner_user_id IS NOT NULL AND d.owner_user_id IS DISTINCT FROM current_user_id())
        OR (d.scope = 'session' AND d.conversation_id IS NOT NULL AND personal_conversation_hidden(d.conversation_id))
      )
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION conversation_audience_bump_past_policy(p_organization_id text, p_conversation_id text)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE "conversations" SET "audience_version" = "audience_version" + 1
   WHERE "id" = p_conversation_id AND "organization_id" = p_organization_id
     AND "organization_id" = current_org();
  RETURN FOUND;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION conversation_audience_bump_past_policy(text, text) IS
  'Bump the audience version of a conversation of the caller''s organization that the caller may no longer read, for a removed grant (0269). False when it does not exist.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION conversation_audience_bump_past_policy(text, text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION conversation_audience_bump_past_policy(text, text) TO %I, %I', rls_role('rw'), rls_role('platform'));
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION conversation_audience_bump_for_share(
  p_organization_id text, p_conversation_id text, p_deleting boolean
) RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE "conversations" SET "audience_version" = "audience_version" + 1
   WHERE "id" = p_conversation_id AND "organization_id" = p_organization_id;
  IF FOUND THEN RETURN; END IF;
  IF p_deleting THEN
    PERFORM conversation_audience_bump_past_policy(p_organization_id, p_conversation_id);
    RETURN;
  END IF;
  RAISE EXCEPTION 'conversation % of % could not take its audience bump', p_conversation_id, p_organization_id
    USING ERRCODE = 'check_violation',
          HINT = 'A grant must name a conversation of its own organization that this role can update (ADR-0194).';
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resource_shares_conversation_reachable() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."resource_type" = 'conversation' AND personal_conversation_hidden(NEW."resource_id") THEN
    RAISE EXCEPTION 'conversation %: only someone who may read a personal chat grants it', NEW."resource_id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS resource_shares_conversation_reachable ON "resource_shares";
--> statement-breakpoint
CREATE TRIGGER resource_shares_conversation_reachable
  BEFORE INSERT OR UPDATE ON "resource_shares"
  FOR EACH ROW EXECUTE FUNCTION resource_shares_conversation_reachable();
--> statement-breakpoint
ALTER FUNCTION mark_revision_thread(text, text) SECURITY DEFINER;
--> statement-breakpoint
REVOKE ALL ON FUNCTION mark_revision_thread(text, text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION mark_revision_thread(text, text) TO %I, %I', rls_role('rw'), rls_role('platform'));
END $$;
--> statement-breakpoint
SELECT secure_table('conversations',
  'organization_id = current_org() AND (project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = current_org())) AND (project_id IS NOT NULL OR created_by = current_user_id() OR current_system_reader() IS NOT NULL OR EXISTS (SELECT 1 FROM resource_shares s WHERE s.resource_type = ''conversation'' AND s.resource_id = conversations.id AND s.organization_id = current_org() AND s.subject_user_id = current_user_id()))');
--> statement-breakpoint
SELECT secure_table('messages', 'organization_id = current_org() AND NOT personal_conversation_hidden(conversation_id)');
--> statement-breakpoint
SELECT secure_table('conversation_reads', 'organization_id = current_org() AND NOT personal_conversation_hidden(conversation_id)');
--> statement-breakpoint
SELECT secure_table('conversation_restricted_folders', 'organization_id = current_org() AND NOT personal_conversation_hidden(conversation_id)');
--> statement-breakpoint
SELECT secure_table('conversation_source_projects', 'organization_id = current_org() AND NOT personal_conversation_hidden(conversation_id)');
--> statement-breakpoint
SELECT secure_table('message_restricted_use', 'organization_id = current_org() AND NOT personal_conversation_hidden(conversation_id)');
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('REVOKE UPDATE, DELETE ON message_restricted_use FROM %I', rls_role('rw'));
END $$;
--> statement-breakpoint
SELECT secure_table('answer_contexts', 'organization_id = current_org() AND NOT personal_conversation_hidden(conversation_id)');
--> statement-breakpoint
SELECT secure_table('agent_asks', 'organization_id = current_org() AND NOT personal_conversation_hidden(conversation_id)');
--> statement-breakpoint
SELECT secure_table('answer_feedback',
  'organization_id = current_org() AND (project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = current_org())) AND (conversation_id IS NULL OR NOT personal_conversation_hidden(conversation_id))');
--> statement-breakpoint
SELECT secure_table('upload_batches',
  'organization_id = current_org() AND (scope <> ''session'' OR conversation_id IS NULL OR NOT personal_conversation_hidden(conversation_id))');
--> statement-breakpoint
SELECT secure_table('documents',
  'organization_id = current_org() AND (project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = current_org())) AND (owner_user_id IS NULL OR owner_user_id = current_user_id() OR current_system_reader() IS NOT NULL) AND (scope <> ''session'' OR conversation_id IS NULL OR NOT personal_conversation_hidden(conversation_id))');
