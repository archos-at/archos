-- Undo 0264. ORDER: roll the frontend back first; the newer build bins office shelf folders.
--
-- Lossy: an office shelf folder in the bin comes back where it lies, its documents unread until re-indexed;
-- a purged office shelf tombstone is removed, and the queue rows of both are closed as restored.
UPDATE "deletion_queue" q SET "status" = 'restored'
  FROM "project_folders" f
 WHERE q."entity_type" = 'folder' AND q."entity_id" = f."id"::text AND f."scope" = 'office_shelf'
   AND q."status" IN ('pending', 'failed');
--> statement-breakpoint
UPDATE "project_folders" SET "deleted_at" = NULL, "deleted_by" = NULL, "bin_root_id" = NULL
 WHERE "scope" = 'office_shelf' AND "deleted_at" IS NOT NULL AND "purged_at" IS NULL;
--> statement-breakpoint
DELETE FROM "project_folders" WHERE "scope" = 'office_shelf' AND "purged_at" IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION refuse_write_into_deleted_folder() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  target_project uuid;
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

  SELECT f.project_id INTO target_project FROM project_folders f WHERE f.id = target;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF target_project IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock_shared(folder_bin_lock_key(target_project));
  END IF;
  SELECT f.deleted_at INTO target_deleted FROM project_folders f WHERE f.id = target;
  IF target_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'folder % is deleted; nothing may be filed into it', target
      USING ERRCODE = 'GFD01';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS shelf_bin_lock_key(text, text, uuid);
--> statement-breakpoint
DROP INDEX IF EXISTS "project_folders_office_shelf_bin_idx";
--> statement-breakpoint
ALTER TABLE "project_folders" DROP CONSTRAINT IF EXISTS "project_folders_bin_state_check";
--> statement-breakpoint
ALTER TABLE "project_folders"
  ADD CONSTRAINT "project_folders_bin_state_check" CHECK (
    ("purged_at" IS NULL OR "deleted_at" IS NOT NULL)
    AND ("bin_root_id" IS NULL OR "deleted_at" IS NOT NULL)
    AND ("deleted_at" IS NULL OR "scope" = 'project')
  );
