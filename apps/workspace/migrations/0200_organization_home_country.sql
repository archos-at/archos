-- 0200: every organization has a row and a home country (design
-- docs/design/international/design.md 5.1, build split S3).
--
-- ## What the home country is
--
-- The country of the office's own seat: where the planning office is, not
-- where its projects are. It will decide the office's default entitlement,
-- clock, locale defaults and DPA text. It NEVER decides which site law applies
-- to a project: a project is placed by its own site (`country`,
-- `federal_state` on its profile), and a project nothing places gets no
-- country's law (agent.common.country_profile.resolve_site). Nothing here may
-- be read as a project's jurisdiction.
--
-- ISO 3166-1 alpha-2, upper case. NULL means unplaced: no one has said where
-- the office is. A new self-service organization states it at creation
-- (POST /api/organizations); see "What stays NULL" below.
--
-- ## The backfill
--
-- Rows used to be created only on an organization's first settings write, so
-- most organizations had none. This writes a row for every organization id the
-- database has seen, in any tenant table with an `organization_id` column, so
-- an office that only ever created projects or chatted has one too. Every
-- organization served before this migration is an Austrian planning office
-- (the product was sold in Austria only), so their home country is AT. That is
-- a statement about the office's seat, made once, here; no code defaults to it.
-- Before this is applied in production, a person checks the WorkOS roster for
-- an organization that is not Austrian and sets its row by hand afterwards.
--
-- ## What stays NULL
--
-- Every row that exists when this runs gets AT. After it, the creation route
-- is the only writer of the value (`placeOrganization`). An organization made
-- in the WorkOS dashboard after this migration has no row until its first
-- write, and a row its first settings save creates has no home country. Both
-- read as unplaced; the platform sets it (design 5.1,
-- `platform-organization-home-country-set`, a later slice). The column
-- therefore stays nullable until that operation exists.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS home_country char(2);
-- The office's clock (IANA zone), replacing the one constant OFFICE_TIME_ZONE
-- where an organization is in scope. Set from the home country when the
-- organization is created; NULL reads as Europe/Vienna, the clock every office
-- had before, until the platform sets it.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS time_zone text;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_time_zone_shape;
ALTER TABLE organizations ADD CONSTRAINT organizations_time_zone_shape
  CHECK (time_zone IS NULL OR time_zone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$');

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_home_country_iso;
ALTER TABLE organizations ADD CONSTRAINT organizations_home_country_iso
  CHECK (home_country IS NULL OR home_country ~ '^[A-Z]{2}$');

COMMENT ON COLUMN organizations.home_country IS
  'ISO 3166-1 alpha-2 country of the office''s own seat. Never a project''s jurisdiction: the site decides site law. NULL: unplaced.';

DO $$
DECLARE
  tenant_table text;
BEGIN
  FOR tenant_table IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organization_id'
      AND c.data_type = 'text'
      AND c.table_name <> 'organizations'
  LOOP
    EXECUTE format(
      'INSERT INTO organizations (workos_organization_id, home_country)
       SELECT DISTINCT organization_id, %L FROM %I WHERE organization_id LIKE %L
       ON CONFLICT (workos_organization_id) DO NOTHING',
      'AT', tenant_table, 'org\_%');
  END LOOP;
END
$$;

UPDATE organizations SET home_country = 'AT' WHERE home_country IS NULL;
UPDATE organizations SET time_zone = 'Europe/Vienna' WHERE time_zone IS NULL;
