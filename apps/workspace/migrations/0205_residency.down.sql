-- Reverse 0205. ORDER: roll the frontend back first; the newer build reads both.
--
-- Lossy: every organization's processing policy and its cell placement go. A
-- re-apply starts with no rows, which reads as the default purposes, and with
-- every office unplaced.
DROP TABLE IF EXISTS organization_processing_policies;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_residency_cell_shape;
ALTER TABLE organizations DROP COLUMN IF EXISTS residency_cell;
