-- Reverse 0241: the functions and the four column defaults read only the
-- `grid.` settings again, as 0031, 0032 and 0213 defined them.
--
-- LOSSLESS, in either order: the setters write both names (the BFF writes
-- `grid.*` in every release from 0241 on), so the old definitions find the
-- tenant whether or not the new setters are still rolled out.

CREATE OR REPLACE FUNCTION current_org() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('grid.organization_id', true), '') $$;
--> statement-breakpoint
COMMENT ON FUNCTION current_org() IS
  'Active tenant for this transaction, from the grid.organization_id GUC. NULL when unset, which makes every tenant policy match zero rows.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION current_user_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('grid.user_id', true), '') $$;
--> statement-breakpoint
COMMENT ON FUNCTION current_user_id() IS
  'Acting user for this transaction, from the grid.user_id GUC. Used by tables keyed to a person rather than an organization.';
--> statement-breakpoint
ALTER TABLE messages
  ALTER COLUMN organization_id SET DEFAULT nullif(current_setting('grid.organization_id', true), '');
--> statement-breakpoint
ALTER TABLE conversation_reads
  ALTER COLUMN organization_id SET DEFAULT nullif(current_setting('grid.organization_id', true), '');
--> statement-breakpoint
ALTER TABLE message_edition_uses
  ALTER COLUMN organization_id SET DEFAULT nullif(current_setting('grid.organization_id', true), '');
--> statement-breakpoint
ALTER TABLE project_base_confirmations
  ALTER COLUMN organization_id SET DEFAULT nullif(current_setting('grid.organization_id', true), '');
