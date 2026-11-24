-- 0241: the row-level-security session settings take the `app.` prefix
-- (ADR-0149 map; `docs/contributing/naming.md` "Renaming a name someone else
-- reads"). `grid.organization_id` becomes `app.organization_id`, and
-- `grid.user_id` becomes `app.user_id`.
--
-- This is the EXPAND step of three:
--
--   1. this migration: both names are read, the new one first. The BFF sets
--      both names (`bff/db/index.ts`), so a function or default of either
--      version finds the tenant;
--   2. backfill and switch: the setters stop writing the old names;
--   3. contract: the old names leave the functions and the defaults.
--
-- ## What reads the setting
--
-- `current_org()` and `current_user_id()`, which every row policy calls, and
-- the column defaults of `messages` and `conversation_reads` (0032) and of
-- `message_edition_uses` and `project_base_confirmations` (0213). Each is
-- defined again here with the same signature, volatility, parallel safety and
-- grants (`CREATE OR REPLACE` keeps the grants). No row is rewritten: a row
-- keeps the organization it was written under, not the setting.
--
-- The old names answer for one release: the next release drops them.
--
-- Idempotent: a function is replaced whole, and a default is set again to the
-- expression it already has.

CREATE OR REPLACE FUNCTION current_org() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT coalesce(nullif(current_setting('app.organization_id', true), ''), nullif(current_setting('grid.organization_id', true), '')) $$;
--> statement-breakpoint
COMMENT ON FUNCTION current_org() IS
  'Active tenant for this transaction, from the app.organization_id setting (grid.organization_id until migration 0241 is released). NULL when unset, which makes every tenant policy match zero rows.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION current_user_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT coalesce(nullif(current_setting('app.user_id', true), ''), nullif(current_setting('grid.user_id', true), '')) $$;
--> statement-breakpoint
COMMENT ON FUNCTION current_user_id() IS
  'Acting user for this transaction, from the app.user_id setting (grid.user_id until migration 0241 is released). Used by tables keyed to a person rather than an organization.';
--> statement-breakpoint
ALTER TABLE messages
  ALTER COLUMN organization_id SET DEFAULT coalesce(nullif(current_setting('app.organization_id', true), ''), nullif(current_setting('grid.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE conversation_reads
  ALTER COLUMN organization_id SET DEFAULT coalesce(nullif(current_setting('app.organization_id', true), ''), nullif(current_setting('grid.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE message_edition_uses
  ALTER COLUMN organization_id SET DEFAULT coalesce(nullif(current_setting('app.organization_id', true), ''), nullif(current_setting('grid.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE project_base_confirmations
  ALTER COLUMN organization_id SET DEFAULT coalesce(nullif(current_setting('app.organization_id', true), ''), nullif(current_setting('grid.organization_id', true), ''));
