-- 0259: a measurement kept on a sheet. A mark gains the shapes `line` (two
-- points), `path` (2 to 60) and `polygon` (3 to 60) with their `points`, and
-- `reading`: what the engine answered for those points when the mark was kept,
-- written by the server only. A reading is true of one document version, so a
-- measurement is never carried onto a newer one (`annotation-carry.ts`).
ALTER TABLE "document_annotations" ADD COLUMN IF NOT EXISTS "points" jsonb;
--> statement-breakpoint
ALTER TABLE "document_annotations" ADD COLUMN IF NOT EXISTS "reading" jsonb;
--> statement-breakpoint
ALTER TABLE "document_annotations" DROP CONSTRAINT IF EXISTS "document_annotations_shape_known";
--> statement-breakpoint
ALTER TABLE "document_annotations" ADD CONSTRAINT "document_annotations_shape_known"
  CHECK ("shape" IN ('point', 'region', 'line', 'path', 'polygon'));
--> statement-breakpoint
ALTER TABLE "document_annotations" DROP CONSTRAINT IF EXISTS "document_annotations_region_on_page";
--> statement-breakpoint
ALTER TABLE "document_annotations" ADD CONSTRAINT "document_annotations_region_on_page"
  CHECK (
    ("shape" = 'point' AND "w" IS NULL AND "h" IS NULL)
    OR ("shape" = 'region' AND "w" > 0 AND "h" > 0 AND "x" + "w" <= 1.000001 AND "y" + "h" <= 1.000001)
    OR ("shape" IN ('line', 'path', 'polygon') AND "w" IS NULL AND "h" IS NULL)
  );
--> statement-breakpoint
-- CASE, because Postgres does not promise to read an AND left to right, and
-- the length of a scalar is an error rather than a refusal.
ALTER TABLE "document_annotations" DROP CONSTRAINT IF EXISTS "document_annotations_points_for_measure_shapes";
--> statement-breakpoint
ALTER TABLE "document_annotations" ADD CONSTRAINT "document_annotations_points_for_measure_shapes"
  CHECK (
    CASE
      WHEN "shape" IN ('point', 'region') THEN "points" IS NULL
      WHEN jsonb_typeof("points") = 'array' THEN
        jsonb_array_length("points") BETWEEN (CASE "shape" WHEN 'polygon' THEN 3 ELSE 2 END)
                                         AND (CASE "shape" WHEN 'line' THEN 2 ELSE 60 END)
        AND NOT jsonb_path_exists(
          "points",
          'strict $[*] ? (@.type() != "array" || @.size() != 2 || @[0].type() != "number" || @[1].type() != "number" || @[0] < 0 || @[0] > 1 || @[1] < 0 || @[1] > 1)'
        )
      ELSE false
    END
  );
--> statement-breakpoint
ALTER TABLE "document_annotations" DROP CONSTRAINT IF EXISTS "document_annotations_measure_reading";
--> statement-breakpoint
ALTER TABLE "document_annotations" ADD CONSTRAINT "document_annotations_measure_reading"
  CHECK (
    "reading" IS NULL
    OR CASE
      WHEN "shape" IN ('line', 'path', 'polygon')
        AND jsonb_typeof("reading") = 'object'
        AND jsonb_typeof("reading" -> 'value') = 'number'
        AND jsonb_typeof("reading" -> 'low') = 'number'
        AND jsonb_typeof("reading" -> 'high') = 'number'
      THEN
        ("reading" ->> 'low')::double precision <= ("reading" ->> 'value')::double precision
        AND ("reading" ->> 'value')::double precision <= ("reading" ->> 'high')::double precision
        AND coalesce("reading" ->> 'unit' IN ('m', 'm2'), false)
        AND (("reading" ->> 'unit') = 'm2') = ("shape" = 'polygon')
        AND coalesce("reading" ->> 'provenance' IN ('printed_figure', 'vector_verified', 'vector_estimated'), false)
        AND coalesce("reading" ->> 'scaleState' IN ('verified', 'estimated', 'uncalibrated'), false)
      ELSE false
    END
  );
