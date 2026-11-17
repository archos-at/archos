-- Reverse 0200. ORDER: roll the frontend back first; the newer build writes
-- `home_country` when an organization is created.
--
-- Lossy: every home country and office time zone goes. The rows the backfill created stay: they
-- hold defaults only (`settings` = '{}'), which every reader already treats
-- like a missing row.
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_home_country_iso;
ALTER TABLE organizations DROP COLUMN IF EXISTS home_country;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_time_zone_shape;
ALTER TABLE organizations DROP COLUMN IF EXISTS time_zone;
