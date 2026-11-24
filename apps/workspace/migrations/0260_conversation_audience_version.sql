-- 0260: a conversation's audience carries a version (ADR-0192, decision 4).
--
-- `audience_version` counts the changes of who may read a conversation. The
-- BFF decides a turn's context under the version it read, and a writer that
-- records what the turn drew on compares it under the audience lock: a changed
-- audience narrows the turn instead of riding on the old one. It replaces the
-- `audienceKey` string the BFF compared before.
--
-- The database bumps it, never the app:
--   * `conversations`: an update of `visibility`, `created_by` or `project_id`.
--     Any other write keeps the version, and a write that sets it by hand is
--     ignored unless it is exactly the next number (the shares trigger below).
--   * `resource_shares` where `resource_type = 'conversation'`: an insert, an
--     update (grants are written by upsert) or a delete bumps the conversation
--     it names, both of them when an update re-points a grant.
--
-- A bump that would be lost raises. Under the runtime role an UPDATE that
-- matches no row because of a tenant mismatch reports nothing, and a silently
-- lost bump would keep an old, wider audience valid. A grant deleted after
-- its conversation (`deleteOrphanedGrants`, `purgeResourceCollaboration`) has
-- nothing to bump, so its delete passes when the conversation does not exist
-- in the caller's organization. `conversation_exists` answers only for the
-- caller's own organization (`current_org()`), runs as the caller, and so can
-- tell nothing about another tenant.
--
-- Existing rows start at 0 and need no backfill. A conversation with no row
-- yet is version NULL in the BFF, never 0.
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "audience_version" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION conversation_exists(p_conversation_id text)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "conversations" WHERE "id" = p_conversation_id AND "organization_id" = current_org()
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION conversation_exists(text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION conversation_exists(text) TO %I, %I', rls_role('rw'), rls_role('platform'));
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION conversation_audience_version_bump()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW."audience_version" IS DISTINCT FROM OLD."audience_version" + 1 THEN
    NEW."audience_version" := OLD."audience_version";
  END IF;
  IF NEW."audience_version" = OLD."audience_version" AND (
       NEW."visibility" IS DISTINCT FROM OLD."visibility"
    OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
    OR NEW."project_id" IS DISTINCT FROM OLD."project_id"
  ) THEN
    NEW."audience_version" := OLD."audience_version" + 1;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS conversations_audience_version ON "conversations";
--> statement-breakpoint
CREATE TRIGGER conversations_audience_version
  BEFORE UPDATE ON "conversations"
  FOR EACH ROW EXECUTE FUNCTION conversation_audience_version_bump();
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
          HINT = 'A grant must name a conversation of its own organization that this role can update (ADR-0192).';
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resource_shares_conversation_audience()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."resource_type" = 'conversation' THEN
    PERFORM conversation_audience_bump_for_share(OLD."organization_id", OLD."resource_id", TG_OP = 'DELETE');
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW."resource_type" = 'conversation' AND (
       TG_OP = 'INSERT'
    OR OLD."resource_type" IS DISTINCT FROM NEW."resource_type"
    OR OLD."resource_id" IS DISTINCT FROM NEW."resource_id"
    OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id"
  ) THEN
    PERFORM conversation_audience_bump_for_share(NEW."organization_id", NEW."resource_id", false);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS resource_shares_conversation_audience ON "resource_shares";
--> statement-breakpoint
CREATE TRIGGER resource_shares_conversation_audience
  AFTER INSERT OR UPDATE OR DELETE ON "resource_shares"
  FOR EACH ROW EXECUTE FUNCTION resource_shares_conversation_audience();
