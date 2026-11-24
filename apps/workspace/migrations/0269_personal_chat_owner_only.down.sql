-- Undo 0269. ORDER: roll the frontend back first; the newer build names the
-- system readers this policy admits, and the older one reads without them.
--
-- Not lossy: no row is written or deleted. Every personal chat is the
-- organization's again, readable by any colleague.
SELECT secure_table('documents',
  'organization_id = current_org() AND (project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = current_org())) AND (owner_user_id IS NULL OR owner_user_id = current_user_id() OR current_system_reader() IS NOT NULL)');
--> statement-breakpoint
SELECT secure_table('upload_batches', 'organization_id = current_org()');
--> statement-breakpoint
SELECT secure_table('answer_feedback',
  'organization_id = current_org() AND (project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = current_org()))');
--> statement-breakpoint
SELECT secure_table('agent_asks', 'organization_id = current_org()');
--> statement-breakpoint
SELECT secure_table('answer_contexts', 'organization_id = current_org()');
--> statement-breakpoint
SELECT secure_table('message_restricted_use', 'organization_id = current_org()');
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('REVOKE UPDATE, DELETE ON message_restricted_use FROM %I', rls_role('rw'));
END $$;
--> statement-breakpoint
SELECT secure_table('conversation_source_projects', 'organization_id = current_org()');
--> statement-breakpoint
SELECT secure_table('conversation_restricted_folders', 'organization_id = current_org()');
--> statement-breakpoint
SELECT secure_table('conversation_reads', 'organization_id = current_org()');
--> statement-breakpoint
SELECT secure_table('messages', 'organization_id = current_org()');
--> statement-breakpoint
SELECT secure_table('conversations',
  'organization_id = current_org() AND (project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = current_org()))');
--> statement-breakpoint
ALTER FUNCTION mark_revision_thread(text, text) SECURITY INVOKER;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION mark_revision_thread(text, text) TO PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS resource_shares_conversation_reachable ON "resource_shares";
--> statement-breakpoint
DROP FUNCTION IF EXISTS resource_shares_conversation_reachable();
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
  IF p_deleting AND NOT conversation_exists(p_conversation_id) THEN RETURN; END IF;
  RAISE EXCEPTION 'conversation % of % could not take its audience bump', p_conversation_id, p_organization_id
    USING ERRCODE = 'check_violation',
          HINT = 'A grant must name a conversation of its own organization that this role can update (ADR-0194).';
END
$$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS conversation_audience_bump_past_policy(text, text);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION personal_document_hidden(document uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = document AND d.organization_id = current_org()
      AND d.owner_user_id IS NOT NULL AND d.owner_user_id IS DISTINCT FROM current_user_id()
      AND current_system_reader() IS NULL
  )
$$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS personal_conversation_hidden(text);
