-- 0205: the platform's own base knowledge in the office layer's records (ADR-0165).
--
-- ## What was missing
--
-- 0202 gave the office its works, editions and copies and left the platform's
-- rows "for later, by inserts and wider CHECKs". Until now the platform's
-- country knowledge (laws, norms, authorities, territories) lived in code and
-- in a pointer registry, so adding a country was a code project. Design
-- `docs/design/international/design.md` §4.4 and §4.5; build split S7.
--
-- ## The shape
--
-- Platform rows are the same records with `organization_id` NULL. Nothing about
-- them is a second lifecycle: a revision is appended, and the head moves.
-- What the platform adds is who may move the head and how:
--
-- - `knowledge_change_requests`: every platform revision belongs to one
--   (`knowledge_revisions.change_request_id`, required for platform rows and
--   refused for office rows).
-- - `knowledge_review_decisions`: a person's verdict on one claim of one
--   revision (insert-only; the newest per claim counts).
-- - `knowledge_approvals`: a person's yes on a submitted request, with the
--   role they approve in and how they said it. Four eyes: nobody approves a
--   request holding a revision they wrote (trigger).
-- - `knowledge_release_moves`: insert-only. A publish appends one per record
--   and channel; the stable one moves `head_revision_id`, and a platform head
--   moves only to what the newest stable move names (trigger). A rollback
--   appends the inverse moves. Preview is a channel of moves, not a column.
-- - `knowledge_index_runs`: the indexing job of a published text and what it
--   honestly got from the corpus.
--
-- Two record types join (`territory`, `authority`), platform only, each with
-- its typed body. Every platform record names the country it belongs to
-- (`country_id`), which is what an office is entitled to.
--
-- ## Entitlement
--
-- An office is entitled to its home country (`organizations.home_country`,
-- 0200) and to each country `organization_countries` names. An
-- office reads a platform record only once it is released (it has a head) and
-- only for a country it is entitled to; a revision or body only once it was
-- released to stable (so an old citation still resolves after a rollback),
-- and only when its record is readable. No row, no read: unknown fails closed.
--
-- ## RLS
--
-- The change-request tables are platform-private (`secure_table(t, 'false')`):
-- the runtime role reads nothing there; the platform routes run as the
-- BYPASSRLS platform role. `organization_countries` is read by its office and
-- written by the platform only. Listed in `rls-coverage.spec.ts`.

ALTER TABLE "knowledge_records" ADD COLUMN IF NOT EXISTS "country_id" text;
--> statement-breakpoint
ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_type_known;
--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_type_known
  CHECK ("type" IN ('work', 'edition', 'manifestation', 'territory', 'authority'));
--> statement-breakpoint
-- Territories and authorities are the platform's; an office names them, never owns them.
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_platform_types
  CHECK ("type" NOT IN ('territory', 'authority') OR "organization_id" IS NULL);
--> statement-breakpoint
-- A platform record belongs to one country (ISO 3166-1 alpha-2), an office record to none.
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_country_is_platform
  CHECK (("organization_id" IS NULL) = ("country_id" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_country_format
  CHECK ("country_id" IS NULL OR "country_id" ~ '^[A-Z]{2}$');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_records_country_type_idx"
  ON "knowledge_records" ("country_id", "type") WHERE "organization_id" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_change_requests" (
  "id" uuid PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "country_id" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  -- The newest release move when the request was opened: a publish over a record
  -- whose head moved since is a conflict (409), never a silent overwrite.
  "base_release_seq" bigint DEFAULT 0 NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "submitted_at" timestamp with time zone,
  "decided_at" timestamp with time zone,
  "published_at" timestamp with time zone,
  CONSTRAINT knowledge_change_requests_status_known CHECK (
    "status" IN ('draft', 'submitted', 'approved', 'rejected', 'published', 'rolled_back')),
  CONSTRAINT knowledge_change_requests_title_bounded CHECK (char_length("title") BETWEEN 1 AND 200),
  CONSTRAINT knowledge_change_requests_country_format CHECK ("country_id" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_change_requests_status_idx" ON "knowledge_change_requests" ("status", "created_at" DESC);
--> statement-breakpoint
ALTER TABLE "knowledge_revisions" ADD COLUMN IF NOT EXISTS "change_request_id" uuid
  REFERENCES "knowledge_change_requests" ("id");
--> statement-breakpoint
-- Every platform revision is proposed in a change request; an office revision never is.
ALTER TABLE "knowledge_revisions" ADD CONSTRAINT knowledge_revisions_change_request_is_platform
  CHECK (("organization_id" IS NULL) = ("change_request_id" IS NOT NULL));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_revisions_change_request_idx"
  ON "knowledge_revisions" ("change_request_id") WHERE "change_request_id" IS NOT NULL;
--> statement-breakpoint
-- A platform text lives in the base corpus by file name; an office copy is an Archiv document.
ALTER TABLE "knowledge_manifestation_revisions" ADD COLUMN IF NOT EXISTS "corpus_file" text;
--> statement-breakpoint
ALTER TABLE "knowledge_manifestation_revisions" ADD CONSTRAINT knowledge_manifestation_revisions_corpus_is_platform
  CHECK ("corpus_file" IS NULL OR ("organization_id" IS NULL AND "corpus_file" ~ '^[^/\\]{1,200}\.pdf$'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_territory_revisions" (
  "revision_id" uuid PRIMARY KEY NOT NULL,
  "record_id" text NOT NULL,
  "organization_id" text,
  "owner_key" text GENERATED ALWAYS AS (coalesce("organization_id", '')) STORED NOT NULL,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  -- Ids of the territories this one lies in (`AT-6` for `AT:gkz:60101`), nearest first.
  "parent_ids" text[] DEFAULT '{}'::text[] NOT NULL,
  -- Codes in other schemes (NUTS, GKZ), never parsed: `{ "nuts": "AT22" }`.
  "aliases" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "valid_from" date,
  "valid_to" date,
  CONSTRAINT knowledge_territory_revisions_platform CHECK ("organization_id" IS NULL),
  CONSTRAINT knowledge_territory_revisions_kind_known CHECK (
    "kind" IN ('union', 'country', 'state', 'district', 'municipality', 'city_district')),
  CONSTRAINT knowledge_territory_revisions_name_bounded CHECK (char_length("name") BETWEEN 1 AND 200),
  CONSTRAINT knowledge_territory_revisions_aliases_object CHECK (jsonb_typeof("aliases") = 'object'),
  CONSTRAINT knowledge_territory_revisions_dates_ordered CHECK (
    "valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" > "valid_from"),
  CONSTRAINT knowledge_territory_revisions_revision_fk FOREIGN KEY ("revision_id", "owner_key")
    REFERENCES "knowledge_revisions" ("revision_id", "owner_key") ON DELETE CASCADE,
  CONSTRAINT knowledge_territory_revisions_record_fk FOREIGN KEY ("revision_id", "record_id")
    REFERENCES "knowledge_revisions" ("revision_id", "record_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_authority_revisions" (
  "revision_id" uuid PRIMARY KEY NOT NULL,
  "record_id" text NOT NULL,
  "organization_id" text,
  "owner_key" text GENERATED ALWAYS AS (coalesce("organization_id", '')) STORED NOT NULL,
  "name" text NOT NULL,
  -- `building_permit`, `heritage`, `fire`…
  "function_codes" text[] DEFAULT '{}'::text[] NOT NULL,
  "seat_territory_id" text NOT NULL,
  -- Where the authority is competent: MA 37 for `AT-9`, never for `AT-6`.
  "competence_territory_ids" text[] NOT NULL,
  "identifiers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT knowledge_authority_revisions_platform CHECK ("organization_id" IS NULL),
  CONSTRAINT knowledge_authority_revisions_name_bounded CHECK (char_length("name") BETWEEN 1 AND 200),
  CONSTRAINT knowledge_authority_revisions_competence_named CHECK (cardinality("competence_territory_ids") >= 1),
  CONSTRAINT knowledge_authority_revisions_identifiers_object CHECK (jsonb_typeof("identifiers") = 'object'),
  CONSTRAINT knowledge_authority_revisions_revision_fk FOREIGN KEY ("revision_id", "owner_key")
    REFERENCES "knowledge_revisions" ("revision_id", "owner_key") ON DELETE CASCADE,
  CONSTRAINT knowledge_authority_revisions_record_fk FOREIGN KEY ("revision_id", "record_id")
    REFERENCES "knowledge_revisions" ("revision_id", "record_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_review_decisions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "change_request_id" uuid NOT NULL REFERENCES "knowledge_change_requests" ("id"),
  "revision_id" uuid NOT NULL REFERENCES "knowledge_revisions" ("revision_id") ON DELETE CASCADE,
  -- The claim within the revision's body: `title`, `identifiers.designation`, `competence_territory_ids`.
  "claim_path" text NOT NULL,
  "decision" text NOT NULL,
  "note" text,
  "reviewer" text NOT NULL,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT knowledge_review_decisions_decision_known CHECK ("decision" IN ('accepted', 'edited', 'rejected')),
  CONSTRAINT knowledge_review_decisions_claim_bounded CHECK (char_length("claim_path") BETWEEN 1 AND 120),
  CONSTRAINT knowledge_review_decisions_note_bounded CHECK ("note" IS NULL OR char_length("note") <= 2000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_review_decisions_request_idx"
  ON "knowledge_review_decisions" ("change_request_id", "revision_id", "claim_path", "decided_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_approvals" (
  "id" uuid PRIMARY KEY NOT NULL,
  "change_request_id" uuid NOT NULL REFERENCES "knowledge_change_requests" ("id"),
  "approver" text NOT NULL,
  "role" text NOT NULL,
  -- How the person said yes: in the app, or answering the door's elicitation.
  "decision_source" text NOT NULL,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT knowledge_approvals_role_known CHECK ("role" IN ('domain_expert', 'counsel', 'second_reviewer')),
  CONSTRAINT knowledge_approvals_source_known CHECK ("decision_source" IN ('app', 'elicitation')),
  CONSTRAINT knowledge_approvals_once UNIQUE ("change_request_id", "approver", "role")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_release_moves" (
  "seq" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "record_id" text NOT NULL REFERENCES "knowledge_records" ("id") ON DELETE CASCADE,
  "channel" text NOT NULL,
  "action" text NOT NULL,
  "from_revision_id" uuid,
  -- NULL when a rollback takes a record back to "never released".
  "to_revision_id" uuid,
  "change_request_id" uuid NOT NULL REFERENCES "knowledge_change_requests" ("id"),
  "released_by" text NOT NULL,
  "decision_source" text NOT NULL,
  "released_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reason" text,
  CONSTRAINT knowledge_release_moves_channel_known CHECK ("channel" IN ('preview', 'stable')),
  CONSTRAINT knowledge_release_moves_action_known CHECK ("action" IN ('publish', 'rollback')),
  CONSTRAINT knowledge_release_moves_source_known CHECK ("decision_source" IN ('app', 'elicitation')),
  CONSTRAINT knowledge_release_moves_publish_names_revision CHECK ("action" = 'rollback' OR "to_revision_id" IS NOT NULL),
  CONSTRAINT knowledge_release_moves_reason_bounded CHECK ("reason" IS NULL OR char_length("reason") <= 1000),
  CONSTRAINT knowledge_release_moves_to_fk FOREIGN KEY ("to_revision_id", "record_id")
    REFERENCES "knowledge_revisions" ("revision_id", "record_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_release_moves_record_idx" ON "knowledge_release_moves" ("record_id", "channel", "seq" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_release_moves_to_idx" ON "knowledge_release_moves" ("to_revision_id") WHERE "channel" = 'stable';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_index_runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "revision_id" uuid NOT NULL REFERENCES "knowledge_revisions" ("revision_id") ON DELETE CASCADE,
  "corpus_file" text NOT NULL,
  "change_request_id" uuid NOT NULL REFERENCES "knowledge_change_requests" ("id"),
  -- requested: the job is enqueued; queued: the corpus accepted it; failed: it did not, with why.
  "state" text DEFAULT 'requested' NOT NULL,
  "failure" text,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT knowledge_index_runs_state_known CHECK ("state" IN ('requested', 'queued', 'failed')),
  CONSTRAINT knowledge_index_runs_failure_named CHECK (("state" = 'failed') = ("failure" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_index_runs_request_idx" ON "knowledge_index_runs" ("change_request_id", "requested_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_countries" (
  -- No foreign key: an organization's row exists only after its first settings write (design §5.1).
  "organization_id" text NOT NULL,
  "country_id" text NOT NULL,
  "entitled_by" text NOT NULL,
  "decision_source" text NOT NULL,
  "entitled_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT organization_countries_pkey PRIMARY KEY ("organization_id", "country_id"),
  CONSTRAINT organization_countries_country_format CHECK ("country_id" ~ '^[A-Z]{2}$'),
  CONSTRAINT organization_countries_source_known CHECK ("decision_source" IN ('app', 'elicitation'))
);
--> statement-breakpoint
-- Insert-only history: a decision, a release move, a review verdict is never rewritten.
CREATE TRIGGER knowledge_territory_revisions_append_only BEFORE UPDATE OR DELETE ON "knowledge_territory_revisions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
CREATE TRIGGER knowledge_authority_revisions_append_only BEFORE UPDATE OR DELETE ON "knowledge_authority_revisions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
CREATE TRIGGER knowledge_review_decisions_append_only BEFORE UPDATE OR DELETE ON "knowledge_review_decisions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
CREATE TRIGGER knowledge_approvals_append_only BEFORE UPDATE OR DELETE ON "knowledge_approvals"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
CREATE TRIGGER knowledge_release_moves_append_only BEFORE UPDATE OR DELETE ON "knowledge_release_moves"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
-- A record's identity, its country included, is fixed; only its head moves.
CREATE OR REPLACE FUNCTION knowledge_records_head_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.organization_id, NEW.type, NEW.document_id, NEW.created_by, NEW.created_at, NEW.country_id)
     IS DISTINCT FROM (OLD.id, OLD.organization_id, OLD.type, OLD.document_id, OLD.created_by, OLD.created_at, OLD.country_id) THEN
    RAISE EXCEPTION 'only head_revision_id of a knowledge record changes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- A platform head moves only to what its newest stable release move names: a
-- publish or a rollback, each recorded first. Nothing else moves it.
CREATE OR REPLACE FUNCTION knowledge_platform_head_follows_release() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE released uuid;
DECLARE found_move boolean;
BEGIN
  IF NEW.organization_id IS NOT NULL OR NEW.head_revision_id IS NOT DISTINCT FROM OLD.head_revision_id THEN
    RETURN NEW;
  END IF;
  SELECT true, to_revision_id INTO found_move, released FROM knowledge_release_moves
    WHERE record_id = NEW.id AND channel = 'stable' ORDER BY seq DESC LIMIT 1;
  IF found_move IS NULL OR released IS DISTINCT FROM NEW.head_revision_id THEN
    RAISE EXCEPTION 'a platform head moves only with a stable release move' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_records_platform_head BEFORE UPDATE ON "knowledge_records"
  FOR EACH ROW EXECUTE FUNCTION knowledge_platform_head_follows_release();
--> statement-breakpoint
-- A platform record is created with no head: its first head is a release.
CREATE OR REPLACE FUNCTION knowledge_platform_born_unreleased() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.head_revision_id IS NOT NULL THEN
    RAISE EXCEPTION 'a platform record is released by a publish, not created released' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_records_platform_born BEFORE INSERT ON "knowledge_records"
  FOR EACH ROW EXECUTE FUNCTION knowledge_platform_born_unreleased();
--> statement-breakpoint
-- A platform revision is written into a request still open for it (a draft).
CREATE OR REPLACE FUNCTION knowledge_revision_into_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.change_request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM knowledge_change_requests WHERE id = NEW.change_request_id AND status = 'draft') THEN
    RAISE EXCEPTION 'platform revisions go into a draft change request' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_revisions_into_draft BEFORE INSERT ON "knowledge_revisions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_revision_into_draft();
--> statement-breakpoint
-- Four eyes: an approval counts only on a submitted request, and never from
-- somebody who wrote a revision in it.
CREATE OR REPLACE FUNCTION knowledge_approval_four_eyes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM knowledge_change_requests WHERE id = NEW.change_request_id AND status = 'submitted') THEN
    RAISE EXCEPTION 'only a submitted change request is approved' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM knowledge_revisions WHERE change_request_id = NEW.change_request_id AND created_by = NEW.approver) THEN
    RAISE EXCEPTION 'an approver may not approve a change request holding a revision they wrote' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_approvals_four_eyes BEFORE INSERT ON "knowledge_approvals"
  FOR EACH ROW EXECUTE FUNCTION knowledge_approval_four_eyes();
--> statement-breakpoint
-- A verdict is on a revision of the request it names.
CREATE OR REPLACE FUNCTION knowledge_review_in_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM knowledge_revisions
                 WHERE revision_id = NEW.revision_id AND change_request_id = NEW.change_request_id) THEN
    RAISE EXCEPTION 'a review decision names a revision of its own change request' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_review_decisions_in_request BEFORE INSERT ON "knowledge_review_decisions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_review_in_request();
--> statement-breakpoint
-- A publish releases a revision of its own approved request; a rollback undoes a published one.
CREATE OR REPLACE FUNCTION knowledge_release_move_allowed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_status text;
BEGIN
  SELECT status INTO request_status FROM knowledge_change_requests WHERE id = NEW.change_request_id;
  IF NEW.action = 'publish' THEN
    IF request_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'only an approved change request is published' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM knowledge_revisions
                   WHERE revision_id = NEW.to_revision_id AND change_request_id = NEW.change_request_id) THEN
      RAISE EXCEPTION 'a publish releases a revision of its own change request' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF request_status IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'only a published change request is rolled back' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_release_moves_allowed BEFORE INSERT ON "knowledge_release_moves"
  FOR EACH ROW EXECUTE FUNCTION knowledge_release_move_allowed();
--> statement-breakpoint
-- Whether a platform revision was ever released to stable. SECURITY DEFINER:
-- the moves are platform-private, and a tenant's read policy asks only this.
CREATE OR REPLACE FUNCTION knowledge_revision_released(target uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM knowledge_release_moves
    WHERE to_revision_id = target AND channel = 'stable' AND action = 'publish')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION knowledge_revision_released(uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION knowledge_revision_released(uuid) TO %I, %I', rls_role('rw'), rls_role('platform'));
END $$;
--> statement-breakpoint
-- Whether the current office is entitled to a country: its home country, or a
-- country the platform entitled it to (design §5.1). No organization, no row,
-- no entitlement. SECURITY DEFINER so the read policy needs no grant on
-- `organizations`; it answers only for `current_org()`.
CREATE OR REPLACE FUNCTION knowledge_country_entitled(country text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_org() IS NOT NULL AND country IS NOT NULL AND (
    EXISTS (SELECT 1 FROM organizations o WHERE o.workos_organization_id = current_org() AND o.home_country = country)
    OR EXISTS (SELECT 1 FROM organization_countries c WHERE c.organization_id = current_org() AND c.country_id = country))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION knowledge_country_entitled(text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION knowledge_country_entitled(text) TO %I, %I', rls_role('rw'), rls_role('platform'));
END $$;
--> statement-breakpoint
-- Platform-private: the runtime role reads and writes nothing here.
SELECT secure_table('knowledge_change_requests', 'false');
--> statement-breakpoint
SELECT secure_table('knowledge_review_decisions', 'false');
--> statement-breakpoint
SELECT secure_table('knowledge_approvals', 'false');
--> statement-breakpoint
SELECT secure_table('knowledge_release_moves', 'false');
--> statement-breakpoint
SELECT secure_table('knowledge_index_runs', 'false');
--> statement-breakpoint
-- An office reads its own entitlements; only the platform writes them.
SELECT secure_table('organization_countries', 'organization_id = current_org()');
--> statement-breakpoint
-- Layered reads, narrowed to entitlement: an office reads a platform record once
-- it is released and only for a country it is entitled to; a revision or body
-- once it was released to stable and its record is readable.
SELECT secure_table('knowledge_records',
  'organization_id = current_org() OR (organization_id IS NULL AND head_revision_id IS NOT NULL '
  'AND knowledge_country_entitled(country_id))');
--> statement-breakpoint
SELECT secure_table('knowledge_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND knowledge_revision_released(revision_id) '
  'AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.id = record_id))');
--> statement-breakpoint
SELECT secure_table('knowledge_work_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND knowledge_revision_released(revision_id) '
  'AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.id = record_id))');
--> statement-breakpoint
SELECT secure_table('knowledge_edition_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND knowledge_revision_released(revision_id) '
  'AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.id = record_id))');
--> statement-breakpoint
SELECT secure_table('knowledge_manifestation_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND knowledge_revision_released(revision_id) '
  'AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.id = record_id))');
--> statement-breakpoint
SELECT secure_table('knowledge_territory_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND knowledge_revision_released(revision_id) '
  'AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.id = record_id))');
--> statement-breakpoint
SELECT secure_table('knowledge_authority_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND knowledge_revision_released(revision_id) '
  'AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.id = record_id))');
--> statement-breakpoint
SELECT secure_table('knowledge_checks',
  'organization_id = current_org() OR (organization_id IS NULL AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.id = target_id))');
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  -- The new bodies take 0202's restrictive write guards: a tenant writes its own rows only.
  FOREACH target IN ARRAY ARRAY['knowledge_territory_revisions', 'knowledge_authority_revisions']
  LOOP
    EXECUTE format('CREATE POLICY tenant_write_guard_ins ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (organization_id = current_org())', target);
    EXECUTE format('CREATE POLICY tenant_write_guard_upd ON %I AS RESTRICTIVE FOR UPDATE USING (organization_id = current_org()) WITH CHECK (organization_id = current_org())', target);
    EXECUTE format('CREATE POLICY tenant_write_guard_del ON %I AS RESTRICTIVE FOR DELETE USING (organization_id = current_org())', target);
  END LOOP;
  -- An office never entitles itself.
  EXECUTE 'CREATE POLICY tenant_write_guard_ins ON organization_countries AS RESTRICTIVE FOR INSERT WITH CHECK (false)';
  EXECUTE 'CREATE POLICY tenant_write_guard_upd ON organization_countries AS RESTRICTIVE FOR UPDATE USING (false) WITH CHECK (false)';
  EXECUTE 'CREATE POLICY tenant_write_guard_del ON organization_countries AS RESTRICTIVE FOR DELETE USING (false)';
  EXECUTE format(
    'REVOKE UPDATE, DELETE ON knowledge_territory_revisions, knowledge_authority_revisions, knowledge_review_decisions, '
    'knowledge_approvals, knowledge_release_moves FROM %I, %I',
    rls_role('rw'), rls_role('platform'));
END $$;
