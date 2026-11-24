-- 0258: a person's own shelf, „Meine Ablage“ (ADR-0191 rule 1).
--
-- A third shelf beside a project and the office shelf, with the scope value
-- `personal` and its owner on the row (`owner_user_id`). The upload pipeline,
-- folders, listing and deletion run against it as against the office shelf;
-- what is new is that only its owner may read it.
--
-- ## Who reads a personal row
--
-- The owner, and nobody else acting as a person: the policy on each table that
-- holds a personal row's name or content adds
--
--   owner_user_id IS NULL OR current_user_id() IS NULL OR owner_user_id = current_user_id()
--
-- to the organization's. A query run for a colleague or an administrator
-- matches no personal row of someone else, whatever its WHERE says, as
-- `personal_memory` (0229) holds for notes. A context with no person at all is
-- a worker (ingestion, search projection, retention), which acts for the
-- document and not for a reader; it keeps reading the row, as it reads every
-- other row of the organization.
--
-- The tables: `documents` and `project_folders` carry the owner. A version
-- (`document_versions`) and a search row (`document_search_facets`) carry the
-- document's name and content, so their policy also asks that the document be
-- visible, which brings the documents policy with it. Annotations already ask
-- that (0130).
--
-- ## When the owner leaves
--
-- Nothing deletes the rows, as nothing deletes personal memory (ADR-0180): they
-- outlive the membership, readable by nobody the application serves.
--
-- Idempotent: every constraint is dropped and added by name, every column added
-- IF NOT EXISTS, and a policy is installed whole by `secure_table`.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "owner_user_id" text;
--> statement-breakpoint
ALTER TABLE "project_folders" ADD COLUMN IF NOT EXISTS "owner_user_id" text;
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_personal_has_owner";
--> statement-breakpoint
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_personal_has_owner"
  CHECK (("scope" = 'personal') = ("owner_user_id" IS NOT NULL) AND ("scope" <> 'personal' OR "project_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_folder_requires_project";
--> statement-breakpoint
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_folder_requires_project"
  CHECK ("folder_id" IS NULL OR "project_id" IS NOT NULL OR "scope" IN ('office_shelf', 'personal'));
--> statement-breakpoint
ALTER TABLE "project_folders" DROP CONSTRAINT IF EXISTS "project_folders_scope_check";
--> statement-breakpoint
ALTER TABLE "project_folders"
  ADD CONSTRAINT "project_folders_scope_check" CHECK ("scope" IN ('project', 'office_shelf', 'personal'));
--> statement-breakpoint
ALTER TABLE "project_folders" DROP CONSTRAINT IF EXISTS "project_folders_personal_has_owner";
--> statement-breakpoint
ALTER TABLE "project_folders"
  ADD CONSTRAINT "project_folders_personal_has_owner" CHECK (("scope" = 'personal') = ("owner_user_id" IS NOT NULL));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_personal_owner_listing_idx"
  ON "documents" ("organization_id", "owner_user_id", "folder_id", "created_at" DESC, "id")
  WHERE "scope" = 'personal';
--> statement-breakpoint
ALTER TABLE "upload_batches" DROP CONSTRAINT IF EXISTS "upload_batches_scope";
--> statement-breakpoint
ALTER TABLE "upload_batches"
  ADD CONSTRAINT "upload_batches_scope" CHECK ("scope" IN ('project', 'office_shelf', 'session', 'personal'));
--> statement-breakpoint
ALTER TABLE "document_access_log" DROP CONSTRAINT IF EXISTS "document_access_log_scope_check";
--> statement-breakpoint
ALTER TABLE "document_access_log"
  ADD CONSTRAINT "document_access_log_scope_check"
  CHECK ("scope" IN ('project', 'office_shelf', 'archiv', 'session', 'personal'));
--> statement-breakpoint
ALTER TABLE "document_quarantine_decisions" DROP CONSTRAINT IF EXISTS "document_quarantine_decisions_scope_check";
--> statement-breakpoint
ALTER TABLE "document_quarantine_decisions"
  ADD CONSTRAINT "document_quarantine_decisions_scope_check"
  CHECK ("scope" IN ('project', 'office_shelf', 'archiv', 'session', 'personal'));
--> statement-breakpoint
ALTER TABLE "document_search_shelves" DROP CONSTRAINT IF EXISTS "document_search_shelves_key_shape";
--> statement-breakpoint
ALTER TABLE "document_search_shelves"
  ADD CONSTRAINT "document_search_shelves_key_shape" CHECK (
    ("shelf_key" = 'office_shelf' AND "project_id" IS NULL)
    OR ("project_id" IS NOT NULL AND "shelf_key" = 'project:' || "project_id"::text)
    OR ("project_id" IS NULL AND "shelf_key" LIKE 'personal:_%')
  );
--> statement-breakpoint
SELECT secure_table('documents',
  'organization_id = current_org() AND (project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = current_org())) AND (owner_user_id IS NULL OR current_user_id() IS NULL OR owner_user_id = current_user_id())');
--> statement-breakpoint
SELECT secure_table('project_folders',
  'organization_id = current_org() AND (owner_user_id IS NULL OR current_user_id() IS NULL OR owner_user_id = current_user_id())');
--> statement-breakpoint
SELECT secure_table('document_versions',
  'organization_id = current_org() AND (project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = current_org())) AND (project_id IS NOT NULL OR EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id))');
--> statement-breakpoint
SELECT secure_table('document_search_facets',
  'organization_id = current_org() AND EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id)');
