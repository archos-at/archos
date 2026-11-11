-- 0237: a measurement kept on a sheet (ADR-0182, slice 8). A mark gains three
-- shapes that carry a points array: `line` (exactly two points, a distance),
-- `path` (two to sixty, a length along them) and `polygon` (three to sixty,
-- the area they enclose). Points are shares of the page as shown, origin top
-- left, like every place on a page; the mark's x/y is its first point, so a
-- reader that knows only a pin still finds the measurement where it begins.
--
-- `measurement` is what the engine answered when the mark was kept: the value
-- with its interval, where it came from and the scale it rests on. One JSON
-- value, written once and read whole, never filtered by a field; the CHECK
-- holds its shape so no writer can store a number without its interval and
-- provenance. It is true of one version of the document: a measurement is not
-- carried onto a newer one (`bff/annotations/service.ts`, `carryToCurrent`).
--
-- Two nullable columns on a table that already carries its policies (0138).
-- A point and a region are unchanged: neither may carry points or a reading.
ALTER TABLE "document_annotations" ADD COLUMN IF NOT EXISTS "points" jsonb;
ALTER TABLE "document_annotations" ADD COLUMN IF NOT EXISTS "measurement" jsonb;

ALTER TABLE "document_annotations" DROP CONSTRAINT IF EXISTS "document_annotations_shape_known";
ALTER TABLE "document_annotations" ADD CONSTRAINT "document_annotations_shape_known"
  CHECK ("shape" IN ('point', 'region', 'line', 'path', 'polygon'));

ALTER TABLE "document_annotations" DROP CONSTRAINT IF EXISTS "document_annotations_region_on_page";
ALTER TABLE "document_annotations" ADD CONSTRAINT "document_annotations_region_on_page"
  CHECK (
    ("shape" = 'point' AND "w" IS NULL AND "h" IS NULL)
    OR ("shape" = 'region' AND "w" > 0 AND "h" > 0 AND "x" + "w" <= 1.000001 AND "y" + "h" <= 1.000001)
    OR ("shape" IN ('line', 'path', 'polygon') AND "w" IS NULL AND "h" IS NULL)
  );

-- Points exactly for the three shapes, a bounded count, each a pair of shares.
-- `CASE`, because Postgres does not promise to read an `AND` left to right and
-- the length of a scalar is an error, not a refusal. The path runs strict so a
-- member that is no pair is a match (refused), never a silent skip.
ALTER TABLE "document_annotations" DROP CONSTRAINT IF EXISTS "document_annotations_points_for_measure_shapes";
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

-- The kept reading: only on a measurement, whole, its interval holding its
-- value, an area in m2 and a length in m.
ALTER TABLE "document_annotations" DROP CONSTRAINT IF EXISTS "document_annotations_measurement_reading";
ALTER TABLE "document_annotations" ADD CONSTRAINT "document_annotations_measurement_reading"
  CHECK (
    "measurement" IS NULL
    OR CASE
      WHEN "shape" IN ('line', 'path', 'polygon')
        AND jsonb_typeof("measurement") = 'object'
        AND jsonb_typeof("measurement" -> 'value') = 'number'
        AND jsonb_typeof("measurement" -> 'low') = 'number'
        AND jsonb_typeof("measurement" -> 'high') = 'number'
      THEN
        ("measurement" ->> 'low')::double precision <= ("measurement" ->> 'value')::double precision
        AND ("measurement" ->> 'value')::double precision <= ("measurement" ->> 'high')::double precision
        AND coalesce("measurement" ->> 'unit' IN ('m', 'm2'), false)
        AND (("measurement" ->> 'unit') = 'm2') = ("shape" = 'polygon')
        AND coalesce("measurement" ->> 'provenance' IN ('printed_figure', 'vector_verified', 'vector_estimated'), false)
        AND coalesce("measurement" ->> 'scaleState' IN ('verified', 'estimated', 'uncalibrated'), false)
      ELSE false
    END
  );
