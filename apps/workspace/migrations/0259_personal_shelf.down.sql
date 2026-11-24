-- Undo 0259. ORDER: roll the frontend back first; the newer build writes personal rows.
--
-- Lossy: every personal document and folder is deleted, as the older schema has
-- no shelf to keep them on. The stored files stay where they lie.
SELECT secure_table('document_search_facets', 'organization_id = current_org()');
--> statement-breakpoint
SELECT secure_table('document_versions',
  'organization_id = current_org() AND (project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = current_org()))');
--> statement-breakpoint
SELECT secure_table('project_folders', 'organization_id = current_org()');
--> statement-breakpoint
SELECT secure_table('documents',
  'organization_id = current_org() AND (project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = current_org()))');
--> statement-breakpoint
DELETE FROM "document_search_shelves" WHERE "shelf_key" LIKE 'personal:%';
--> statement-breakpoint
DELETE FROM "documents" WHERE "scope" = 'personal';
--> statement-breakpoint
DELETE FROM "project_folders" WHERE "scope" = 'personal';
--> statement-breakpoint
DELETE FROM "upload_batches" WHERE "scope" = 'personal';
--> statement-breakpoint
ALTER TABLE "document_search_shelves" DROP CONSTRAINT IF EXISTS "document_search_shelves_key_shape";
--> statement-breakpoint
ALTER TABLE "document_search_shelves"
  ADD CONSTRAINT "document_search_shelves_key_shape" CHECK (
    ("shelf_key" = 'office_shelf' AND "project_id" IS NULL)
    OR ("project_id" IS NOT NULL AND "shelf_key" = 'project:' || "project_id"::text)
  );
--> statement-breakpoint
ALTER TABLE "upload_batches" DROP CONSTRAINT IF EXISTS "upload_batches_scope";
--> statement-breakpoint
ALTER TABLE "upload_batches"
  ADD CONSTRAINT "upload_batches_scope" CHECK ("scope" IN ('project', 'office_shelf', 'session'));
--> statement-breakpoint
ALTER TABLE "project_folders" DROP CONSTRAINT IF EXISTS "project_folders_personal_has_owner";
--> statement-breakpoint
ALTER TABLE "project_folders" DROP CONSTRAINT IF EXISTS "project_folders_scope_check";
--> statement-breakpoint
ALTER TABLE "project_folders"
  ADD CONSTRAINT "project_folders_scope_check" CHECK ("scope" IN ('project', 'office_shelf'));
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_folder_requires_project";
--> statement-breakpoint
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_folder_requires_project"
  CHECK ("folder_id" IS NULL OR "project_id" IS NOT NULL OR "scope" = 'office_shelf');
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_personal_has_owner";
--> statement-breakpoint
DROP INDEX IF EXISTS "documents_personal_owner_listing_idx";
--> statement-breakpoint
ALTER TABLE "project_folders" DROP COLUMN IF EXISTS "owner_user_id";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "owner_user_id";
--> statement-breakpoint
DROP FUNCTION IF EXISTS organization_storage_by_scope();
--> statement-breakpoint
DROP FUNCTION IF EXISTS personal_document_hidden(uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS current_system_reader();
