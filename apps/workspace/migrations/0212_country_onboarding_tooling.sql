-- 0212: the country-neutral tooling to onboard a country and keep it current
-- through the platform door (ADR-0174, design §3.7, §4.1 to §4.5, build split S16).
--
-- ## What was missing
--
-- After ADR-0170 an operator's agent could propose territories, works and
-- rulesets, but a country's public SOURCES were files in the repository
-- (`configs/sources/`, ADR-0162), so onboarding a country still needed a git
-- change and a deploy. Nothing noticed when a source changed. A ruleset could
-- not yet carry an advice policy or terminology, and nothing required counsel
-- for the one or a privacy review for a source that receives a site point.
--
-- ## The shape
--
-- - Two ruleset payload schemas, `advice_policy.v1` and `terminology.v1`, each
--   serving its own purpose (as 0207 did for the setup records).
-- - A platform record type `source`: a public source as a reviewed record.
--   Its body (`knowledge_source_revisions`) keeps the record whole (`config`,
--   the shape `packages/public-sources` validates) and lifts out what the
--   database itself decides on: the hosts, the data flow, the monitor.
-- - The host allowlist is read from these rows, never kept beside them: a
--   published source's hosts are active; a draft source's hosts are usable by
--   its own change request's test and capture for 24 hours (design §4.1).
-- - `knowledge_source_credentials`: a source's key, write-only (Vault or a
--   local AES envelope, as `org_llm_credentials`), one active per source.
-- - `knowledge_source_monitor_states`: what a source's monitor saw last.
-- - A change request says where it came from (`origin`): an operator, or a
--   monitor that found its source changed; at most one open per source.
-- - The approver role `privacy_reviewer`, and the roles a publish needs:
--   counsel for an advice policy, a privacy reviewer for a site-keyed source.
--
-- ## RLS
--
-- Every new table is platform-private, as the change-request tables are: no
-- office reads a source's configuration, credential or monitor state; the
-- platform routes and the monitor run as the platform role. The body's policy
-- names `organization_id = current_org()`, which no row meets (the column is
-- NULL by CHECK); the credential carries no `organization_id` at all.

ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_schema_known;
--> statement-breakpoint
ALTER TABLE "knowledge_ruleset_revisions" ADD CONSTRAINT knowledge_ruleset_revisions_schema_known CHECK (
  "payload_schema" IS NULL OR "payload_schema" IN (
    'decision_table.v1', 'fact_definitions.v1', 'fact_sources.v1', 'advice_policy.v1', 'terminology.v1'));
--> statement-breakpoint
ALTER TABLE "knowledge_ruleset_revisions" ADD CONSTRAINT knowledge_ruleset_revisions_prompt_purpose CHECK (
  ("payload_schema" IS DISTINCT FROM 'advice_policy.v1' OR "purpose" = 'advice_policy')
  AND ("payload_schema" IS DISTINCT FROM 'terminology.v1' OR "purpose" = 'terminology'));
--> statement-breakpoint
ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_type_known;
--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_type_known
  CHECK ("type" IN ('work', 'edition', 'manifestation', 'ruleset', 'territory', 'authority', 'relation', 'source'));
--> statement-breakpoint
ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_platform_types;
--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_platform_types
  CHECK ("type" NOT IN ('territory', 'authority', 'source') OR "organization_id" IS NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_source_revisions" (
  "revision_id" uuid PRIMARY KEY NOT NULL,
  "record_id" text NOT NULL,
  "organization_id" text,
  "owner_key" text GENERATED ALWAYS AS (coalesce("organization_id", '')) STORED NOT NULL,
  "title" text NOT NULL,
  "territory_id" text NOT NULL,
  "protocol" text NOT NULL,
  "format" text NOT NULL,
  -- Exact DNS names; the fetcher refuses every other host at every redirect hop.
  "hosts" text[] NOT NULL,
  "data_flow" text NOT NULL,
  "monitor_kind" text NOT NULL,
  "monitor_interval_hours" integer NOT NULL,
  "licence" text NOT NULL,
  -- The record as `packages/public-sources` validates it (`Source`), whole.
  "config" jsonb NOT NULL,
  CONSTRAINT knowledge_source_revisions_platform CHECK ("organization_id" IS NULL),
  CONSTRAINT knowledge_source_revisions_title_bounded CHECK (char_length("title") BETWEEN 1 AND 200),
  CONSTRAINT knowledge_source_revisions_territory_format CHECK ("territory_id" ~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$'),
  CONSTRAINT knowledge_source_revisions_protocol_known CHECK ("protocol" IN ('rest', 'http_eli', 'web_document', 'ogc')),
  CONSTRAINT knowledge_source_revisions_format_known CHECK ("format" IN ('ris_xml', 'akn', 'html_statute', 'geojson')),
  CONSTRAINT knowledge_source_revisions_hosts_bounded CHECK (cardinality("hosts") BETWEEN 1 AND 20),
  CONSTRAINT knowledge_source_revisions_hosts_names CHECK (
    array_to_string("hosts", ' ') ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?( [a-z0-9]([a-z0-9.-]*[a-z0-9])?)*$'),
  CONSTRAINT knowledge_source_revisions_data_flow_known CHECK ("data_flow" IN ('public_only', 'site_keyed')),
  CONSTRAINT knowledge_source_revisions_monitor_known CHECK ("monitor_kind" IN ('none', 'sha256', 'etag', 'version')),
  CONSTRAINT knowledge_source_revisions_interval_bounded CHECK ("monitor_interval_hours" BETWEEN 1 AND 744),
  CONSTRAINT knowledge_source_revisions_licence_known CHECK ("licence" IN ('public_open', 'public_restricted', 'licensed')),
  CONSTRAINT knowledge_source_revisions_config_object CHECK (jsonb_typeof("config") = 'object'),
  CONSTRAINT knowledge_source_revisions_revision_fk FOREIGN KEY ("revision_id", "owner_key")
    REFERENCES "knowledge_revisions" ("revision_id", "owner_key") ON DELETE CASCADE,
  CONSTRAINT knowledge_source_revisions_record_fk FOREIGN KEY ("revision_id", "record_id")
    REFERENCES "knowledge_revisions" ("revision_id", "record_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_source_revisions_record_idx" ON "knowledge_source_revisions" ("record_id");
--> statement-breakpoint
CREATE TRIGGER knowledge_source_revisions_append_only BEFORE UPDATE OR DELETE ON "knowledge_source_revisions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_source_credentials" (
  "id" uuid PRIMARY KEY NOT NULL,
  "record_id" text NOT NULL REFERENCES "knowledge_records" ("id") ON DELETE CASCADE,
  -- The organization the secret is bound to (the platform's): the AAD of a local envelope, Vault's context.
  -- Not `organization_id`: no tenant reads a key, the platform organization's members included.
  "secret_owner_id" text NOT NULL,
  "secret_backend" text NOT NULL,
  "vault_object_id" text,
  "encrypted_key" text,
  -- What a person may see of it: the last four characters.
  "key_hint" text NOT NULL,
  "set_by" text NOT NULL,
  "decision_source" text NOT NULL,
  "set_at" timestamp with time zone DEFAULT now() NOT NULL,
  "replaced_at" timestamp with time zone,
  CONSTRAINT knowledge_source_credentials_backend_known CHECK ("secret_backend" IN ('workos-vault', 'local-aes-gcm')),
  CONSTRAINT knowledge_source_credentials_one_secret CHECK (
    ("secret_backend" = 'workos-vault' AND "vault_object_id" IS NOT NULL AND "encrypted_key" IS NULL)
    OR ("secret_backend" = 'local-aes-gcm' AND "encrypted_key" IS NOT NULL AND "vault_object_id" IS NULL)),
  CONSTRAINT knowledge_source_credentials_hint_bounded CHECK (char_length("key_hint") <= 8),
  CONSTRAINT knowledge_source_credentials_source_known CHECK ("decision_source" IN ('app', 'elicitation'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_source_credentials_active"
  ON "knowledge_source_credentials" ("record_id") WHERE "replaced_at" IS NULL;
--> statement-breakpoint
-- Only a source record holds a credential.
CREATE OR REPLACE FUNCTION knowledge_source_credential_on_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM knowledge_records WHERE id = NEW.record_id AND type = 'source' AND organization_id IS NULL) THEN
    RAISE EXCEPTION 'a source credential belongs to a platform source record' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_source_credentials_on_source BEFORE INSERT ON "knowledge_source_credentials"
  FOR EACH ROW EXECUTE FUNCTION knowledge_source_credential_on_source();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_source_monitor_states" (
  "record_id" text PRIMARY KEY NOT NULL REFERENCES "knowledge_records" ("id") ON DELETE CASCADE,
  "checked_at" timestamp with time zone NOT NULL,
  -- The last check that reached the source; NULL until one did.
  "ok_at" timestamp with time zone,
  "failure" text,
  "etag" text,
  "sha256" text,
  "version" text,
  "terms_sha256" text,
  CONSTRAINT knowledge_source_monitor_states_sha256_format CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT knowledge_source_monitor_states_terms_format CHECK ("terms_sha256" IS NULL OR "terms_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT knowledge_source_monitor_states_failure_bounded CHECK ("failure" IS NULL OR char_length("failure") <= 500)
);
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'operator' NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" ADD COLUMN IF NOT EXISTS "source_record_id" text REFERENCES "knowledge_records" ("id");
--> statement-breakpoint
-- What the monitor found: the previous and the current etag, sha256 and version, whether the terms changed, and needs[].
ALTER TABLE "knowledge_change_requests" ADD COLUMN IF NOT EXISTS "monitor_finding" jsonb;
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" ADD CONSTRAINT knowledge_change_requests_origin_known
  CHECK ("origin" IN ('operator', 'monitor'));
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" ADD CONSTRAINT knowledge_change_requests_monitor_names_source CHECK (
  ("origin" = 'monitor') = ("source_record_id" IS NOT NULL)
  AND ("origin" = 'monitor') = ("monitor_finding" IS NOT NULL)
  AND ("monitor_finding" IS NULL OR jsonb_typeof("monitor_finding") = 'object'));
--> statement-breakpoint
-- A monitor opens at most one request per source while one is open: a second change goes into the same review.
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_change_requests_one_open_per_source"
  ON "knowledge_change_requests" ("source_record_id")
  WHERE "origin" = 'monitor' AND "status" IN ('draft', 'submitted', 'approved');
--> statement-breakpoint
ALTER TABLE "knowledge_approvals" DROP CONSTRAINT IF EXISTS knowledge_approvals_role_known;
--> statement-breakpoint
ALTER TABLE "knowledge_approvals" ADD CONSTRAINT knowledge_approvals_role_known
  CHECK ("role" IN ('domain_expert', 'counsel', 'second_reviewer', 'privacy_reviewer'));
--> statement-breakpoint
-- The roles a request needs before anything of it is published (design §4.4): counsel
-- for an advice policy, a privacy reviewer for a source that receives a site point.
CREATE OR REPLACE FUNCTION knowledge_required_approval_roles(request uuid) RETURNS text[]
  LANGUAGE sql STABLE AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN EXISTS (
      SELECT 1 FROM knowledge_revisions r JOIN knowledge_ruleset_revisions b ON b.revision_id = r.revision_id
      WHERE r.change_request_id = request AND b.payload_schema = 'advice_policy.v1') THEN 'counsel' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM knowledge_revisions r JOIN knowledge_source_revisions s ON s.revision_id = r.revision_id
      WHERE r.change_request_id = request AND s.data_flow = 'site_keyed') THEN 'privacy_reviewer' END
  ], NULL)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION knowledge_publish_has_required_roles() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE missing text[];
BEGIN
  IF NEW.action <> 'publish' THEN
    RETURN NEW;
  END IF;
  SELECT array_agg(needed) INTO missing FROM unnest(knowledge_required_approval_roles(NEW.change_request_id)) AS needed
    WHERE NOT EXISTS (SELECT 1 FROM knowledge_approvals a WHERE a.change_request_id = NEW.change_request_id AND a.role = needed);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'the change request needs an approval as %', array_to_string(missing, ', ') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_release_moves_required_roles BEFORE INSERT ON "knowledge_release_moves"
  FOR EACH ROW EXECUTE FUNCTION knowledge_publish_has_required_roles();
--> statement-breakpoint
-- A body is a platform row (organization_id is always NULL, by CHECK), so no tenant reads one.
SELECT secure_table('knowledge_source_revisions', 'organization_id = current_org()');
--> statement-breakpoint
SELECT secure_table('knowledge_source_credentials', 'false');
--> statement-breakpoint
SELECT secure_table('knowledge_source_monitor_states', 'false');
