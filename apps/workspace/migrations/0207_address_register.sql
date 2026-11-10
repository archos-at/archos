-- 0207: official address registers, hosted in the cell (ADR-0172; design 4.8, 5.3; build split S12).
--
-- A typed site address is looked up here, never at a public geocoder: every
-- keystroke stays in the cell. A register is imported whole, as the publisher
-- ships it on a reference date (Austria: the BEV Adressregister's relational
-- tables), by `apps/workspace/scripts/import-address-register.ts`.
--
-- ## address_register_releases
--
-- One import of one register on one reference date. A release is `loading`
-- while its rows are written, `active` once complete (one active release per
-- register, the partial unique index), and `retired` when a newer one is
-- activated; the importer deletes a retired release's rows. A lookup reads the
-- active release only, so a half-written import is never read.
--
-- ## address_register_entries
--
-- One address of a release, keyed by the register's own id (BEV: ADRCD). The
-- keys (`street_key`, `house_key`, `place_keys`) are written by the importer
-- with the same functions the resolver reads a typed line with
-- (`bff/site-resolution/normalize.ts`), so SQL compares keys and never folds
-- text itself. Coordinates are kept as the register ships them (`crs` is the
-- EPSG code: BEV uses MGI/Austria GK, 31254 to 31256), not reprojected.
--
-- ## Not tenant data
--
-- A public register, the same for every office: `secure_platform_table`, which
-- lets every tenant read and only the platform role write. Not a platform
-- knowledge record either (ADR-0165): 2.5 million rows of a publisher's list
-- are not claims a reviewer can read one by one; the release is the unit, and
-- the importer refuses a release that shrinks the active one by more than it
-- was told to accept, or that is not newer than it.

CREATE TABLE IF NOT EXISTS address_register_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  register text NOT NULL,
  country_id char(2) NOT NULL,
  reference_date date NOT NULL,
  attribution text NOT NULL,
  source_url text,
  entry_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'loading',
  imported_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  CONSTRAINT address_register_releases_register_shape CHECK (register ~ '^[a-z]{2}-[a-z0-9-]{2,30}$'),
  CONSTRAINT address_register_releases_country_iso CHECK (country_id ~ '^[A-Z]{2}$'),
  CONSTRAINT address_register_releases_status_known CHECK (status IN ('loading', 'active', 'retired')),
  CONSTRAINT address_register_releases_count_positive CHECK (entry_count >= 0),
  CONSTRAINT address_register_releases_active_has_rows CHECK (status <> 'active' OR (entry_count > 0 AND activated_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS address_register_releases_one_active
  ON address_register_releases (register) WHERE status = 'active';
--> statement-breakpoint
COMMENT ON TABLE address_register_releases IS
  'One import of an official address register on a reference date (ADR-0172). Lookups read the active release only.';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS address_register_entries (
  release_id uuid NOT NULL REFERENCES address_register_releases (id) ON DELETE CASCADE,
  address_id text NOT NULL,
  municipality_code text NOT NULL,
  municipality_name text NOT NULL,
  locality_name text,
  postcode text NOT NULL,
  street_name text NOT NULL,
  house_number text NOT NULL,
  street_key text NOT NULL,
  house_key text NOT NULL,
  place_keys text[] NOT NULL DEFAULT '{}',
  easting double precision,
  northing double precision,
  crs integer,
  PRIMARY KEY (release_id, address_id),
  CONSTRAINT address_register_entries_keys_present CHECK (street_key <> '' AND house_key <> '')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS address_register_entries_lookup
  ON address_register_entries (release_id, street_key, house_key);
--> statement-breakpoint
COMMENT ON TABLE address_register_entries IS
  'One address of an official register release, with the keys the resolver compares (ADR-0172).';
--> statement-breakpoint
SELECT secure_platform_table('address_register_releases');
--> statement-breakpoint
SELECT secure_platform_table('address_register_entries');
