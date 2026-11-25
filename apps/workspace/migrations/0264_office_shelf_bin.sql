-- 0264: the Bürobibliothek gets a Papierkorb of its own (ADR-0195, KAN-90).
--
-- Until now only a PROJECT folder could be deleted in place (0115): an office
-- shelf folder re-filed what it held into its parent and its row went. An office
-- shelf folder now goes to the bin like a project folder: the subtree gets
-- `deleted_at` and `bin_root_id`, a `deletion_queue` row (`entity_type =
-- 'folder'`) is the entry, and the purge leaves a tombstone (`purged_at`).
-- A person's own shelf („Meine Ablage“, scope `personal`, ADR-0193) keeps the
-- re-filing delete and is never in either state.
--
-- ## The bin lock of a shelf
--
-- A project's bin lock is keyed by the project (`folder_bin_lock_key`). The
-- office shelf has no project, so `shelf_bin_lock_key` names the lock of either
-- shelf: the project's key unchanged (a frontend of the previous release and
-- the trigger below take the same lock), the office shelf's by its
-- organization. The trigger that refuses filing into a deleted folder (0115)
-- now takes the office shelf's lock too, so an insert or a move into an office
-- shelf folder either commits before its bin or waits and is refused (GFD01).

ALTER TABLE "project_folders" DROP CONSTRAINT IF EXISTS "project_folders_bin_state_check";
--> statement-breakpoint
ALTER TABLE "project_folders"
  ADD CONSTRAINT "project_folders_bin_state_check" CHECK (
    ("purged_at" IS NULL OR "deleted_at" IS NOT NULL)
    AND ("bin_root_id" IS NULL OR "deleted_at" IS NOT NULL)
    AND ("deleted_at" IS NULL OR "scope" IN ('project', 'office_shelf'))
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_folders_office_shelf_bin_idx"
  ON "project_folders" USING btree ("organization_id")
  WHERE "scope" = 'office_shelf' AND "deleted_at" IS NOT NULL AND "purged_at" IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION shelf_bin_lock_key(p_scope text, p_organization_id text, p_project_id uuid) RETURNS bigint
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_scope
    WHEN 'project' THEN folder_bin_lock_key(p_project_id)
    WHEN 'office_shelf' THEN hashtextextended('office-shelf-bin:' || p_organization_id, 0)
  END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION shelf_bin_lock_key(text, text, uuid) IS
  'The advisory lock of a shelf''s Papierkorb: a project''s by the project (folder_bin_lock_key), the office shelf''s by its organization; NULL for a shelf without a bin. The services (bff/projects/folder-bin-repository.ts) and the deleted-folder trigger take it through this one function.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION refuse_write_into_deleted_folder() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  target_key bigint;
  target_deleted timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'documents' THEN
    target := NEW.folder_id;
    IF TG_OP = 'UPDATE' AND target IS NOT DISTINCT FROM OLD.folder_id THEN
      RETURN NEW;
    END IF;
  ELSE
    target := NEW.parent_id;
    IF TG_OP = 'UPDATE' AND target IS NOT DISTINCT FROM OLD.parent_id THEN
      RETURN NEW;
    END IF;
  END IF;
  IF target IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT shelf_bin_lock_key(f.scope, f.organization_id, f.project_id) INTO target_key
    FROM project_folders f WHERE f.id = target;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  -- Waits while the folder's shelf is being moved to or from its bin; the read
  -- below is a new statement, so it sees what that transaction committed.
  IF target_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock_shared(target_key);
  END IF;
  SELECT f.deleted_at INTO target_deleted FROM project_folders f WHERE f.id = target;
  IF target_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'folder % is deleted; nothing may be filed into it', target
      USING ERRCODE = 'GFD01';
  END IF;
  RETURN NEW;
END
$$;
