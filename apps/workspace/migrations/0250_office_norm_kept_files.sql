-- 0250: the office-shelf files an office keeps as ordinary files although their
-- name reads as a norm („Im Ordner lassen“). One row per document; ARCHOS never
-- offers that document for Normen & Richtlinien again
-- (`bff/base-knowledge/office/folder-norms.ts`). Deleting the document deletes
-- its row.
CREATE TABLE IF NOT EXISTS "office_norm_kept_files" (
  "document_id" uuid PRIMARY KEY NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL,
  "kept_by" text NOT NULL,
  "kept_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_office_norm_kept_files_organization"
  ON "office_norm_kept_files" ("organization_id");
--> statement-breakpoint
SELECT secure_table('office_norm_kept_files', 'organization_id = current_org()');
