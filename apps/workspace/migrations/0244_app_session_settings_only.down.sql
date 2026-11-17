-- Reverse 0244: the functions and the four column defaults read the `app.` setting
-- first and the `grid.` one second, as 0241 defined them. Never back to 0031:
-- from 0244 on the BFF sets only the `app.` names.

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
