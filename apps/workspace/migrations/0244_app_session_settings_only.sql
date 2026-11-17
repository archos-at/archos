-- 0244: the row-level-security session settings are read under their `app.`
-- names only. The SWITCH step of the rename 0241 expanded
-- (`docs/deployment/brand-free-stored-names-runbook.md`, section 1).
--
-- Every BFF release since 0241 sets `app.organization_id` and `app.user_id`
-- (`bff/db/index.ts`), so a pod that has not rolled yet still finds its tenant
-- here. From this release on the BFF sets only the `app.` names.
--
-- `current_org()`, `current_user_id()` and the four `organization_id` column
-- defaults are defined again with the same signature, volatility, parallel
-- safety and grants. No row is rewritten.
--
-- Idempotent: a function is replaced whole, and a default is set again to the
-- expression it already has.

CREATE OR REPLACE FUNCTION current_org() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.organization_id', true), '') $$;
--> statement-breakpoint
COMMENT ON FUNCTION current_org() IS
  'Active tenant for this transaction, from the app.organization_id setting. NULL when unset, which makes every tenant policy match zero rows.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION current_user_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;
--> statement-breakpoint
COMMENT ON FUNCTION current_user_id() IS
  'Acting user for this transaction, from the app.user_id setting. Used by tables keyed to a person rather than an organization.';
--> statement-breakpoint
ALTER TABLE messages
  ALTER COLUMN organization_id SET DEFAULT nullif(current_setting('app.organization_id', true), '');
--> statement-breakpoint
ALTER TABLE conversation_reads
  ALTER COLUMN organization_id SET DEFAULT nullif(current_setting('app.organization_id', true), '');
--> statement-breakpoint
ALTER TABLE message_edition_uses
  ALTER COLUMN organization_id SET DEFAULT nullif(current_setting('app.organization_id', true), '');
--> statement-breakpoint
ALTER TABLE project_base_confirmations
  ALTER COLUMN organization_id SET DEFAULT nullif(current_setting('app.organization_id', true), '');
