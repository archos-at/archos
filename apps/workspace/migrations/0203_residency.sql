-- 0203: where an organization's data is processed, and what it may be used for
-- (ADR-0167; design docs/design/international/design.md 5.1, 6.1, 6.5).
--
-- ## organizations.residency_cell
--
-- The cell the office is placed in: one deployment, one Pulumi stack holding
-- every store (`configs/residency/cells.yaml`, e.g. `eu-at-1`). A deployment
-- names its own cell in RESIDENCY_CELL; the model seam refuses to serve an
-- organization placed in a different cell (agent.common.residency). NULL means
-- not placed yet: the office is served by the cell it reaches, under that
-- cell's zone, which is the only cell there is. No backfill: placing every
-- office is a statement a person makes once residency is switched on, not one a
-- migration makes for them.
--
-- ## organization_processing_policies
--
-- What an office's data may be processed for, one row per organization. No row
-- reads as the defaults below; a policy that cannot be read at all allows
-- `service` alone (fail closed). `purpose_ok` on every chat trace comes from
-- here, and the Langfuse judges run only on traces whose organization allows
-- `quality_evaluation` (an include-only rule filter). `product_improvement` is
-- opt-in, never a default. `service` is always allowed: without it there is no
-- product. `version` moves with every write, so a trace names the policy it ran
-- under.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS residency_cell text;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_residency_cell_shape;
ALTER TABLE organizations ADD CONSTRAINT organizations_residency_cell_shape
  CHECK (residency_cell IS NULL OR residency_cell ~ '^[a-z]{2}-[a-z]{2}-[0-9]+$');

COMMENT ON COLUMN organizations.residency_cell IS
  'The residency cell (deployment) the office is placed in, e.g. eu-at-1. Another cell refuses to serve it. NULL: not placed.';

CREATE TABLE IF NOT EXISTS organization_processing_policies (
  organization_id text PRIMARY KEY,
  version integer NOT NULL DEFAULT 1,
  purposes_allowed text[] NOT NULL DEFAULT ARRAY['service', 'quality_evaluation', 'human_review']::text[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  CONSTRAINT organization_processing_policies_version_positive CHECK (version >= 1),
  CONSTRAINT organization_processing_policies_purposes_known
    CHECK (purposes_allowed <@ ARRAY['service', 'quality_evaluation', 'human_review', 'product_improvement']::text[]),
  CONSTRAINT organization_processing_policies_service_allowed CHECK ('service' = ANY (purposes_allowed))
);

COMMENT ON TABLE organization_processing_policies IS
  'Purposes an organization''s data may be processed for (ADR-0167). No row: service, quality_evaluation, human_review.';

SELECT secure_table('organization_processing_policies', 'organization_id = current_org()');
