-- 0250: a norm in a project goes to the Büroablage (ADR-0185).
--
-- `office_shelf_references` is the Verweis a project keeps where a norm lay
-- after it went to the Büroablage. The norm's bytes become an office shelf
-- document of their own (the project's file goes to the project's Papierkorb),
-- so the reference names both: `source_document_id`, the project file it
-- replaced (no foreign key: the bin purges that row later), and
-- `office_document_id`, the copy in the Büroablage. Removing that copy sets
-- the column NULL and keeps the row, so the project shows the reference as
-- removed instead of losing it.
--
-- `office_shelf_norm_keeps` remembers „Hier lassen“: a project norm somebody
-- decided stays in its project. Nothing offers it for the Büroablage again;
-- the row goes with its document.
--
-- `proposed_changes` takes a fifth kind, `office_shelf_norm`: somebody without
-- the right to manage the Büroablage suggests a project norm for it, and a
-- person who may manage it decides. Only the kind CHECK moves.
CREATE TABLE IF NOT EXISTS "office_shelf_references" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "folder_id" uuid,
  "source_document_id" uuid NOT NULL,
  "office_document_id" uuid,
  "file_name" text NOT NULL,
  "placed_as" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT office_shelf_references_project_fkey FOREIGN KEY ("project_id", "organization_id")
    REFERENCES "projects" ("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT office_shelf_references_folder_fkey FOREIGN KEY ("folder_id")
    REFERENCES "project_folders" ("id") ON DELETE CASCADE,
  CONSTRAINT office_shelf_references_office_document_fkey FOREIGN KEY ("office_document_id", "organization_id")
    REFERENCES "documents" ("id", "organization_id") ON DELETE SET NULL ("office_document_id"),
  CONSTRAINT office_shelf_references_placed_as_known CHECK ("placed_as" IN ('moved', 'edition', 'duplicate')),
  CONSTRAINT office_shelf_references_file_name_bounded CHECK (char_length(btrim("file_name")) BETWEEN 1 AND 512),
  CONSTRAINT office_shelf_references_source_once UNIQUE ("project_id", "source_document_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_office_shelf_references_folder"
  ON "office_shelf_references" ("project_id", "folder_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_office_shelf_references_office_document"
  ON "office_shelf_references" ("office_document_id") WHERE "office_document_id" IS NOT NULL;
--> statement-breakpoint
SELECT secure_table('office_shelf_references', 'organization_id = current_org()');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "office_shelf_norm_keeps" (
  "document_id" uuid PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "kept_by" text NOT NULL,
  "kept_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT office_shelf_norm_keeps_document_fkey FOREIGN KEY ("document_id", "organization_id")
    REFERENCES "documents" ("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT office_shelf_norm_keeps_project_fkey FOREIGN KEY ("project_id", "organization_id")
    REFERENCES "projects" ("id", "organization_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_office_shelf_norm_keeps_project"
  ON "office_shelf_norm_keeps" ("organization_id", "project_id");
--> statement-breakpoint
SELECT secure_table('office_shelf_norm_keeps', 'organization_id = current_org()');
--> statement-breakpoint
ALTER TABLE "proposed_changes" DROP CONSTRAINT IF EXISTS proposed_changes_kind_known;
--> statement-breakpoint
ALTER TABLE "proposed_changes" ADD CONSTRAINT proposed_changes_kind_known
  CHECK ("kind" IN ('file_operation', 'memory', 'project_profile', 'operation', 'office_shelf_norm'));
