-- Drawing calibrations: the scale a PERSON set for a region of a page of a
-- drawing (ADR-0183).
--
-- A vector drawing's scale is otherwise a hint: a region the file stores, a
-- note the sheet prints. The agent states a length from a hint only when the
-- sheet's own dimension figures agree with it, and never decides a threshold
-- from one (ADR-0182). A row here is what turns a region `verified`: two
-- points a person clicked on the page and the true length between them.
--
-- * A calibration belongs to ONE version of a document (`version_id`, NOT
--   NULL): a new version is other bytes, and nothing carries over.
-- * It belongs to a REGION of a page, never the page by default: the box is
--   four shares of the page as shown (origin top left), both reference points
--   lie inside it, and the row says so in CHECKs, not only in the service.
-- * The row holds what the person did (two points, a length), not a scale:
--   the scale follows from the page's size, which the reader of the file
--   knows and a client only claims. The agent's engine and the viewer each
--   compute it from the page they read.
-- * The lifecycle is `active`, `superseded`, `withdrawn` (ADR-0179). Setting a
--   region again supersedes its active row; withdrawing one does NOT revive
--   what it superseded. At most one active row per region, by the index below.
CREATE TABLE IF NOT EXISTS "drawing_calibrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "document_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "page" integer NOT NULL,
  "region_x" double precision NOT NULL,
  "region_y" double precision NOT NULL,
  "region_w" double precision NOT NULL,
  "region_h" double precision NOT NULL,
  "point_a_x" double precision NOT NULL,
  "point_a_y" double precision NOT NULL,
  "point_b_x" double precision NOT NULL,
  "point_b_y" double precision NOT NULL,
  "reference_length_m" double precision NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "withdrawn_at" timestamp with time zone,
  "withdrawn_by" text,
  CONSTRAINT drawing_calibrations_document_fk
    FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE,
  CONSTRAINT drawing_calibrations_version_fk
    FOREIGN KEY ("version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE,
  CONSTRAINT drawing_calibrations_status_known CHECK ("status" IN ('active', 'superseded', 'withdrawn')),
  CONSTRAINT drawing_calibrations_page_positive CHECK ("page" BETWEEN 1 AND 100000),
  CONSTRAINT drawing_calibrations_region_on_page CHECK (
    "region_x" >= 0 AND "region_y" >= 0 AND "region_w" > 0 AND "region_h" > 0
    AND "region_x" + "region_w" <= 1.000001 AND "region_y" + "region_h" <= 1.000001
  ),
  CONSTRAINT drawing_calibrations_points_in_region CHECK (
    "point_a_x" BETWEEN "region_x" AND "region_x" + "region_w"
    AND "point_b_x" BETWEEN "region_x" AND "region_x" + "region_w"
    AND "point_a_y" BETWEEN "region_y" AND "region_y" + "region_h"
    AND "point_b_y" BETWEEN "region_y" AND "region_y" + "region_h"
  ),
  CONSTRAINT drawing_calibrations_points_apart CHECK ("point_a_x" <> "point_b_x" OR "point_a_y" <> "point_b_y"),
  CONSTRAINT drawing_calibrations_length_positive CHECK ("reference_length_m" > 0 AND "reference_length_m" <= 100000),
  CONSTRAINT drawing_calibrations_withdrawal_stamped CHECK (
    ("status" = 'withdrawn') = ("withdrawn_at" IS NOT NULL AND "withdrawn_by" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_drawing_calibrations_page"
  ON "drawing_calibrations" ("organization_id", "document_id", "version_id", "page", "created_at" DESC);
--> statement-breakpoint
-- One active calibration per region: setting the same box again supersedes
-- (`setDrawingCalibration` does both in one transaction), and two people
-- setting it at once cannot both win.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_drawing_calibrations_active_region"
  ON "drawing_calibrations" ("organization_id", "version_id", "page", "region_x", "region_y", "region_w", "region_h")
  WHERE "status" = 'active';
--> statement-breakpoint
SELECT secure_table('drawing_calibrations', 'organization_id = current_org()');
