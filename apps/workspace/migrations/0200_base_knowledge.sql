-- 0200: base knowledge records, one set of tables for the platform and every office (ADR-0158).
--
-- ## What was missing
--
-- An office's licensed ÖNORM copy, a commentary on its Bauordnung or an MA 37
-- Weisung was one Archiv file among many: nothing said what kind of source it
-- is, which edition it holds, where it applies, which authority a directive
-- binds, or when somebody last checked it was still current. The agent read
-- it like a letter. Ticket 32; design `docs/design/international/design.md`
-- §3.4, §4.7 and §8.1.
--
-- ## The shape (FRBR, as ELI uses it)
--
-- A **work** is the abstract instrument (ÖNORM B 1600, the MANZ commentary
-- on the BO Wien, an MA 37 Weisung): kind, title, identifiers (the standard
-- designation first), territories, issuer and addressees. An **edition** is
-- the Ausgabe: label and dates. A **manifestation** is a held copy: language,
-- text status and licence class.
--
-- Each is a header row in `knowledge_records` and an append-only history in
-- `knowledge_revisions`, whose typed body sits in one table per record type.
-- `head_revision_id` names the revision in force; for an office a
-- confirmation moves it, nothing else does. `knowledge_checks` records that
-- somebody checked an edition or a copy was still current, and what they found.
--
-- ## Owner
--
-- Every table carries `organization_id`, NULL for the platform, and the
-- generated `owner_key` the composite foreign keys use, so a revision can
-- only belong to a record of its own owner. Platform rows arrive later by
-- inserts and wider CHECKs, with no data migration (design §8.1).
--
-- ## Removal
--
-- An office's record names the Archiv document it was read from
-- (`document_id`, composite with the organization, ON DELETE CASCADE).
-- Deleting the document deletes its records, their revisions, bodies and
-- checks in the same statement: nothing to forget and nothing a second
-- lifecycle could keep. A revision, body or check is otherwise never updated
-- or deleted (the trigger below and the REVOKE at the end).
--
-- ## RLS
--
-- Layered: a tenant reads its own rows and released platform rows, and
-- writes its own rows only (restrictive guards, the 0089 pattern). Listed in
-- `rls-coverage.spec.ts` BOUNDARY_MIGRATIONS.

CREATE TABLE IF NOT EXISTS "knowledge_records" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text,
  "owner_key" text GENERATED ALWAYS AS (coalesce("organization_id", '')) STORED NOT NULL,
  "type" text NOT NULL,
  "head_revision_id" uuid,
  "document_id" uuid,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT knowledge_records_type_known CHECK ("type" IN ('work', 'edition', 'manifestation')),
  CONSTRAINT knowledge_records_id_bounded CHECK (char_length("id") BETWEEN 1 AND 120),
  CONSTRAINT knowledge_records_document_is_office CHECK ("document_id" IS NULL OR "organization_id" IS NOT NULL),
  CONSTRAINT knowledge_records_id_type_key UNIQUE ("id", "type"),
  CONSTRAINT knowledge_records_id_owner_key UNIQUE ("id", "owner_key"),
  CONSTRAINT knowledge_records_document_fk FOREIGN KEY ("document_id", "organization_id")
    REFERENCES "documents" ("id", "organization_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_records_org_type_idx" ON "knowledge_records" ("organization_id", "type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_records_document_idx" ON "knowledge_records" ("document_id") WHERE "document_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_revisions" (
  "revision_id" uuid PRIMARY KEY NOT NULL,
  "record_id" text NOT NULL,
  "record_type" text NOT NULL,
  "organization_id" text,
  "owner_key" text GENERATED ALWAYS AS (coalesce("organization_id", '')) STORED NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Where the values came from: `{ "proposedBy": "reading" | "person" | "agent", "note"?: string }`.
  "provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT knowledge_revisions_provenance_object CHECK (jsonb_typeof("provenance") = 'object'),
  CONSTRAINT knowledge_revisions_revision_record_key UNIQUE ("revision_id", "record_id"),
  CONSTRAINT knowledge_revisions_revision_owner_key UNIQUE ("revision_id", "owner_key"),
  CONSTRAINT knowledge_revisions_record_type_fk FOREIGN KEY ("record_id", "record_type")
    REFERENCES "knowledge_records" ("id", "type") ON DELETE CASCADE,
  CONSTRAINT knowledge_revisions_record_owner_fk FOREIGN KEY ("record_id", "owner_key")
    REFERENCES "knowledge_records" ("id", "owner_key") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_revisions_record_idx" ON "knowledge_revisions" ("record_id", "created_at");
--> statement-breakpoint
ALTER TABLE "knowledge_records"
  ADD CONSTRAINT knowledge_records_head_fk FOREIGN KEY ("head_revision_id", "id")
  REFERENCES "knowledge_revisions" ("revision_id", "record_id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_work_revisions" (
  "revision_id" uuid PRIMARY KEY NOT NULL,
  "record_id" text NOT NULL,
  "organization_id" text,
  "owner_key" text GENERATED ALWAYS AS (coalesce("organization_id", '')) STORED NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  -- `{ "designation"?: "ÖNORM B 1600:2017", "eli"?: ..., ... }`: the designation is how a
  -- later platform listing finds the office's work and attaches instead of duplicating.
  "identifiers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- ISO 3166 ids (`AT`, `AT-9`); empty for a standards body's work.
  "territory_ids" text[] DEFAULT '{}'::text[] NOT NULL,
  "issuer" text,
  -- A directive's addressees: `[{ "name": "MA 37", "territoryId": "AT-9" }]`. Authority
  -- records replace the name with an id later (design §3.3), as an addition.
  "addressees" jsonb DEFAULT '[]'::jsonb NOT NULL,
  CONSTRAINT knowledge_work_revisions_kind_known CHECK (
    "kind" IN ('technical_standard', 'guideline', 'commentary', 'authority_directive', 'statute')),
  CONSTRAINT knowledge_work_revisions_title_bounded CHECK (char_length("title") BETWEEN 1 AND 300),
  CONSTRAINT knowledge_work_revisions_identifiers_object CHECK (jsonb_typeof("identifiers") = 'object'),
  CONSTRAINT knowledge_work_revisions_addressees_array CHECK (jsonb_typeof("addressees") = 'array'),
  CONSTRAINT knowledge_work_revisions_revision_fk FOREIGN KEY ("revision_id", "owner_key")
    REFERENCES "knowledge_revisions" ("revision_id", "owner_key") ON DELETE CASCADE,
  CONSTRAINT knowledge_work_revisions_record_fk FOREIGN KEY ("revision_id", "record_id")
    REFERENCES "knowledge_revisions" ("revision_id", "record_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_work_revisions_designation_idx"
  ON "knowledge_work_revisions" (("identifiers" ->> 'designation'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_edition_revisions" (
  "revision_id" uuid PRIMARY KEY NOT NULL,
  "record_id" text NOT NULL,
  "organization_id" text,
  "owner_key" text GENERATED ALWAYS AS (coalesce("organization_id", '')) STORED NOT NULL,
  "work_id" text NOT NULL,
  "work_type" text DEFAULT 'work' NOT NULL,
  -- The Ausgabe as its masthead prints it: `2017-04-01`, `2023`, `Fassung 2019`.
  "label" text NOT NULL,
  "issued_on" date,
  "in_force_from" date,
  "in_force_to" date,
  "outline" jsonb DEFAULT '[]'::jsonb NOT NULL,
  CONSTRAINT knowledge_edition_revisions_work_type CHECK ("work_type" = 'work'),
  CONSTRAINT knowledge_edition_revisions_label_bounded CHECK (char_length("label") BETWEEN 1 AND 120),
  CONSTRAINT knowledge_edition_revisions_outline_array CHECK (jsonb_typeof("outline") = 'array'),
  CONSTRAINT knowledge_edition_revisions_dates_ordered CHECK (
    "in_force_to" IS NULL OR "in_force_from" IS NULL OR "in_force_to" >= "in_force_from"),
  CONSTRAINT knowledge_edition_revisions_work_fk FOREIGN KEY ("work_id", "work_type")
    REFERENCES "knowledge_records" ("id", "type") ON DELETE CASCADE,
  CONSTRAINT knowledge_edition_revisions_revision_fk FOREIGN KEY ("revision_id", "owner_key")
    REFERENCES "knowledge_revisions" ("revision_id", "owner_key") ON DELETE CASCADE,
  CONSTRAINT knowledge_edition_revisions_record_fk FOREIGN KEY ("revision_id", "record_id")
    REFERENCES "knowledge_revisions" ("revision_id", "record_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_manifestation_revisions" (
  "revision_id" uuid PRIMARY KEY NOT NULL,
  "record_id" text NOT NULL,
  "organization_id" text,
  "owner_key" text GENERATED ALWAYS AS (coalesce("organization_id", '')) STORED NOT NULL,
  "edition_id" text NOT NULL,
  "edition_type" text DEFAULT 'edition' NOT NULL,
  "form" text DEFAULT 'text' NOT NULL,
  "language" text DEFAULT 'de' NOT NULL,
  "text_status" text DEFAULT 'authentic' NOT NULL,
  "licence_class" text NOT NULL,
  -- `{ "quoteMaxChars"?: number, "validTo"?: "YYYY-MM-DD", "attestedBy"?: userId, "attestedAt"?: iso }`.
  "terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "sha256" text,
  CONSTRAINT knowledge_manifestation_revisions_edition_type CHECK ("edition_type" = 'edition'),
  CONSTRAINT knowledge_manifestation_revisions_form_known CHECK ("form" IN ('text', 'dataset', 'link')),
  CONSTRAINT knowledge_manifestation_revisions_language_bounded CHECK (char_length("language") BETWEEN 2 AND 35),
  CONSTRAINT knowledge_manifestation_revisions_text_status_known CHECK (
    "text_status" IN ('authentic', 'official_non_prevailing', 'translation')),
  CONSTRAINT knowledge_manifestation_revisions_licence_known CHECK (
    "licence_class" IN ('public_open', 'public_restricted', 'licensed')),
  -- No licensed text on the platform until the licensed seam and contracts allow it (design P12).
  CONSTRAINT knowledge_manifestation_revisions_licensed_is_office CHECK (
    "organization_id" IS NOT NULL OR "licence_class" <> 'licensed'),
  CONSTRAINT knowledge_manifestation_revisions_terms_object CHECK (jsonb_typeof("terms") = 'object'),
  CONSTRAINT knowledge_manifestation_revisions_edition_fk FOREIGN KEY ("edition_id", "edition_type")
    REFERENCES "knowledge_records" ("id", "type") ON DELETE CASCADE,
  CONSTRAINT knowledge_manifestation_revisions_revision_fk FOREIGN KEY ("revision_id", "owner_key")
    REFERENCES "knowledge_revisions" ("revision_id", "owner_key") ON DELETE CASCADE,
  CONSTRAINT knowledge_manifestation_revisions_record_fk FOREIGN KEY ("revision_id", "record_id")
    REFERENCES "knowledge_revisions" ("revision_id", "record_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_checks" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" text,
  "owner_key" text GENERATED ALWAYS AS (coalesce("organization_id", '')) STORED NOT NULL,
  "target_id" text NOT NULL,
  "target_type" text NOT NULL,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "checked_by" text NOT NULL,
  "result" text NOT NULL,
  "note" text,
  CONSTRAINT knowledge_checks_target_type_known CHECK ("target_type" IN ('edition', 'manifestation')),
  CONSTRAINT knowledge_checks_result_known CHECK (
    "result" IN ('current', 'newer_known', 'withdrawn', 'source_unreachable')),
  CONSTRAINT knowledge_checks_note_bounded CHECK ("note" IS NULL OR char_length("note") <= 1000),
  -- The platform checks editions; an office checks its own copies (design §3.4).
  CONSTRAINT knowledge_checks_owner_target CHECK (
    ("organization_id" IS NULL AND "target_type" = 'edition')
    OR ("organization_id" IS NOT NULL AND "target_type" = 'manifestation')),
  CONSTRAINT knowledge_checks_target_fk FOREIGN KEY ("target_id", "target_type")
    REFERENCES "knowledge_records" ("id", "type") ON DELETE CASCADE,
  CONSTRAINT knowledge_checks_target_owner_fk FOREIGN KEY ("target_id", "owner_key")
    REFERENCES "knowledge_records" ("id", "owner_key") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_checks_target_idx" ON "knowledge_checks" ("target_id", "checked_at" DESC);
--> statement-breakpoint
-- A body names the revision of its own record, and an edition or a copy names a
-- record of its own owner or of the platform, never another office's. Under RLS
-- another office's record is invisible, so the lookup fails as "not found" too.
CREATE OR REPLACE FUNCTION knowledge_refuse_cross_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target text;
  target_owner text;
  found_target boolean;
BEGIN
  IF TG_TABLE_NAME = 'knowledge_edition_revisions' THEN
    target := NEW.work_id;
  ELSIF TG_TABLE_NAME = 'knowledge_manifestation_revisions' THEN
    target := NEW.edition_id;
  ELSE
    RETURN NEW;
  END IF;
  SELECT true, organization_id INTO found_target, target_owner FROM knowledge_records WHERE id = target;
  IF found_target IS NULL THEN
    RAISE EXCEPTION 'knowledge record % is not visible to this owner', target USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF target_owner IS NOT NULL AND target_owner IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'knowledge record % belongs to another owner', target USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_edition_revisions_owner BEFORE INSERT ON "knowledge_edition_revisions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_refuse_cross_owner();
--> statement-breakpoint
CREATE TRIGGER knowledge_manifestation_revisions_owner BEFORE INSERT ON "knowledge_manifestation_revisions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_refuse_cross_owner();
--> statement-breakpoint
-- Append-only. An UPDATE is refused always; a DELETE only when it is a cascade
-- from its record's removal (a referential action runs as a trigger, so the
-- depth is above one), never as a statement of its own.
CREATE OR REPLACE FUNCTION knowledge_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION '% rows go only with their record', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_revisions_append_only BEFORE UPDATE OR DELETE ON "knowledge_revisions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
CREATE TRIGGER knowledge_work_revisions_append_only BEFORE UPDATE OR DELETE ON "knowledge_work_revisions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
CREATE TRIGGER knowledge_edition_revisions_append_only BEFORE UPDATE OR DELETE ON "knowledge_edition_revisions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
CREATE TRIGGER knowledge_manifestation_revisions_append_only BEFORE UPDATE OR DELETE ON "knowledge_manifestation_revisions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
CREATE TRIGGER knowledge_checks_append_only BEFORE UPDATE OR DELETE ON "knowledge_checks"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
-- A record's only mutable column is its head: confirmation moves it.
CREATE OR REPLACE FUNCTION knowledge_records_head_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.organization_id, NEW.type, NEW.document_id, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.organization_id, OLD.type, OLD.document_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'only head_revision_id of a knowledge record changes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_records_head_only BEFORE UPDATE ON "knowledge_records"
  FOR EACH ROW EXECUTE FUNCTION knowledge_records_head_only();
--> statement-breakpoint
-- Layered reads: an office reads its own rows, and a platform row once it is in
-- force (a record with a head, a revision that is some record's head). Release
-- moves (design §4.4) replace "is a head" when the platform layer lands.
SELECT secure_table('knowledge_records',
  'organization_id = current_org() OR (organization_id IS NULL AND head_revision_id IS NOT NULL)');
--> statement-breakpoint
SELECT secure_table('knowledge_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.head_revision_id = revision_id))');
--> statement-breakpoint
SELECT secure_table('knowledge_work_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.head_revision_id = revision_id))');
--> statement-breakpoint
SELECT secure_table('knowledge_edition_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.head_revision_id = revision_id))');
--> statement-breakpoint
SELECT secure_table('knowledge_manifestation_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.head_revision_id = revision_id))');
--> statement-breakpoint
SELECT secure_table('knowledge_checks', 'organization_id = current_org() OR organization_id IS NULL');
--> statement-breakpoint
-- Writes are stricter than reads (0089): restrictive policies AND with the
-- permissive one, so a tenant can neither write nor delete a platform row.
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['knowledge_records', 'knowledge_revisions', 'knowledge_work_revisions',
    'knowledge_edition_revisions', 'knowledge_manifestation_revisions', 'knowledge_checks']
  LOOP
    EXECUTE format('CREATE POLICY tenant_write_guard_ins ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (organization_id = current_org())', target);
    EXECUTE format('CREATE POLICY tenant_write_guard_upd ON %I AS RESTRICTIVE FOR UPDATE USING (organization_id = current_org()) WITH CHECK (organization_id = current_org())', target);
    EXECUTE format('CREATE POLICY tenant_write_guard_del ON %I AS RESTRICTIVE FOR DELETE USING (organization_id = current_org())', target);
  END LOOP;
  -- After `secure_table`, which grants every command: history is never edited or
  -- deleted by the runtime roles. A cascade runs as the table owner and still removes it.
  EXECUTE format(
    'REVOKE UPDATE, DELETE ON knowledge_revisions, knowledge_work_revisions, knowledge_edition_revisions, '
    'knowledge_manifestation_revisions, knowledge_checks FROM %I, %I',
    rls_role('rw'), rls_role('platform'));
END $$;
