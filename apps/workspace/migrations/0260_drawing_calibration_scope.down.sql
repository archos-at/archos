-- Reverse 0260. ORDER: roll the frontend and the agent back first.
--
-- LOSSY: every document-wide calibration is deleted; the pages it covered
-- read as estimated or uncalibrated again.
DELETE FROM "drawing_calibrations" WHERE "scope" = 'document';
--> statement-breakpoint
DROP INDEX IF EXISTS "uniq_drawing_calibrations_active_document";
--> statement-breakpoint
DROP INDEX IF EXISTS "uniq_drawing_calibrations_active_region";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_drawing_calibrations_active_region"
  ON "drawing_calibrations" ("organization_id", "version_id", "page", "region_x", "region_y", "region_w", "region_h")
  WHERE "status" = 'active';
--> statement-breakpoint
ALTER TABLE "drawing_calibrations"
  DROP CONSTRAINT IF EXISTS drawing_calibrations_document_whole_page,
  DROP CONSTRAINT IF EXISTS drawing_calibrations_document_sized,
  DROP CONSTRAINT IF EXISTS drawing_calibrations_scope_known,
  DROP COLUMN IF EXISTS "reference_height_pt",
  DROP COLUMN IF EXISTS "reference_width_pt",
  DROP COLUMN IF EXISTS "scope";
