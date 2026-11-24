-- A calibration can hold for a whole document, not only for a region of one
-- page (ADR-0183): `scope = 'document'` is the default scale of every page of
-- one version. A page's own calibration, whatever its region, overrides it.
--
-- * A document row keeps the page it was measured on (`page`) and that page's
--   size in points: the scale is paper scale, so the same ratio holds on a
--   page of another size, but the two points are shares of the page they were
--   clicked on and only that size turns them into a length per point.
-- * Its region is the whole page. At most one document row is active per
--   version; setting it again supersedes the old one.
-- * A page row's "same region" rule no longer sees document rows, so a person
--   can set a whole-page scale on one page without replacing the document's.
ALTER TABLE "drawing_calibrations" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'page' NOT NULL;
--> statement-breakpoint
ALTER TABLE "drawing_calibrations" ADD COLUMN IF NOT EXISTS "reference_width_pt" double precision;
--> statement-breakpoint
ALTER TABLE "drawing_calibrations" ADD COLUMN IF NOT EXISTS "reference_height_pt" double precision;
--> statement-breakpoint
ALTER TABLE "drawing_calibrations"
  ADD CONSTRAINT drawing_calibrations_scope_known CHECK ("scope" IN ('page', 'document')),
  ADD CONSTRAINT drawing_calibrations_document_sized CHECK (
    ("scope" = 'document') = ("reference_width_pt" IS NOT NULL AND "reference_height_pt" IS NOT NULL)
    AND ("reference_width_pt" IS NULL OR ("reference_width_pt" > 0 AND "reference_width_pt" <= 200000))
    AND ("reference_height_pt" IS NULL OR ("reference_height_pt" > 0 AND "reference_height_pt" <= 200000))
  ),
  ADD CONSTRAINT drawing_calibrations_document_whole_page CHECK (
    "scope" <> 'document'
    OR ("region_x" = 0 AND "region_y" = 0 AND "region_w" >= 0.999999 AND "region_h" >= 0.999999)
  );
--> statement-breakpoint
DROP INDEX IF EXISTS "uniq_drawing_calibrations_active_region";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_drawing_calibrations_active_region"
  ON "drawing_calibrations" ("organization_id", "version_id", "page", "region_x", "region_y", "region_w", "region_h")
  WHERE "status" = 'active' AND "scope" = 'page';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_drawing_calibrations_active_document"
  ON "drawing_calibrations" ("organization_id", "version_id")
  WHERE "status" = 'active' AND "scope" = 'document';
