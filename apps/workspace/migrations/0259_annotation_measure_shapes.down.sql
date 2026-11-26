-- Reverse 0259. ORDER: roll the frontend back first; the newer build reads and
-- writes both columns.
--
-- LOSSY: every kept measurement (a mark of shape line, path or polygon) is
-- deleted with its thread, because the older CHECKs know only a point and a
-- region. Points and regions are untouched.
DELETE FROM "document_annotations" WHERE "shape" IN ('line', 'path', 'polygon');

ALTER TABLE "document_annotations" DROP CONSTRAINT IF EXISTS "document_annotations_measure_reading";
ALTER TABLE "document_annotations" DROP CONSTRAINT IF EXISTS "document_annotations_points_for_measure_shapes";

ALTER TABLE "document_annotations" DROP CONSTRAINT IF EXISTS "document_annotations_region_on_page";
ALTER TABLE "document_annotations" ADD CONSTRAINT "document_annotations_region_on_page"
  CHECK (
    ("shape" = 'point' AND "w" IS NULL AND "h" IS NULL)
    OR ("shape" = 'region' AND "w" > 0 AND "h" > 0 AND "x" + "w" <= 1.000001 AND "y" + "h" <= 1.000001)
  );

ALTER TABLE "document_annotations" DROP CONSTRAINT IF EXISTS "document_annotations_shape_known";
ALTER TABLE "document_annotations" ADD CONSTRAINT "document_annotations_shape_known"
  CHECK ("shape" IN ('point', 'region'));

ALTER TABLE "document_annotations" DROP COLUMN IF EXISTS "reading";
ALTER TABLE "document_annotations" DROP COLUMN IF EXISTS "points";
