-- 0203: rulesets, a base knowledge record whose payload is a decision table (ADR-0166).
--
-- ## What was missing
--
-- Which building class a project falls in, which authority is competent, which
-- reference date applies: each is a country rule, and each was code
-- (`project-intake/derivations.ts` for Austria's Gebäudeklasse). A second
-- country would have been a second module. Design
-- `docs/design/international/design.md` §3.7, ticket 30.
--
-- ## The shape
--
-- A ruleset is a fourth record type beside work, edition and manifestation,
-- in the same tables (ADR-0163): a header row in `knowledge_records`, an
-- append-only history in `knowledge_revisions`, and its typed body here. The
-- body says what it decides (`purpose`), where (`territory_ids`), optionally
-- for which works, from when to when (half-open), which edition the table
-- encodes, and either the table (`payload_schema`, `payload`) or
-- `inherits = 'parent'`, never both. The payload is checked by the wire's
-- zod schema and its own examples before a write; the SQL holds the shape.
--
-- `fact_definitions`, `fact_sources`, `advice_policy` and `terminology` are
-- named purposes already, but no payload schema serves them yet, so a row of
-- theirs can only say `inherits`. Their schema arrives with the slice that
-- first reads them, by widening `knowledge_ruleset_revisions_schema_known`.
--
-- ## RLS
--
-- As 0202: an office reads its own rows and platform rows in force, writes
-- only its own; history is never updated or deleted by the runtime roles.
-- Listed in `rls-coverage.spec.ts` BOUNDARY_MIGRATIONS.

ALTER TABLE "knowledge_records" DROP CONSTRAINT "knowledge_records_type_known";
--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_type_known
  CHECK ("type" IN ('work', 'edition', 'manifestation', 'ruleset'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_ruleset_revisions" (
  "revision_id" uuid PRIMARY KEY NOT NULL,
  "record_id" text NOT NULL,
  "organization_id" text,
  "owner_key" text GENERATED ALWAYS AS (coalesce("organization_id", '')) STORED NOT NULL,
  "purpose" text NOT NULL,
  -- Territory ids as design §3.2 writes them (`AT`, `DE-BE`, `AT:gkz:90001`); opaque, never parsed.
  "territory_ids" text[] NOT NULL,
  -- Work-targeted rulesets decide for these works only (BauNVO's reference date).
  "work_ids" text[] DEFAULT '{}'::text[] NOT NULL,
  "valid_from" date NOT NULL,
  -- Exclusive: the first day the ruleset no longer applies.
  "valid_to" date,
  "basis_edition_id" text,
  "basis_edition_type" text DEFAULT 'edition' NOT NULL,
  "inherits" text,
  "payload_schema" text,
  "payload" jsonb,
  CONSTRAINT knowledge_ruleset_revisions_purpose_known CHECK (
    "purpose" IN ('classification', 'derivation', 'reference_date', 'competence',
      'fact_definitions', 'fact_sources', 'advice_policy', 'terminology')),
  CONSTRAINT knowledge_ruleset_revisions_schema_known CHECK (
    "payload_schema" IS NULL OR "payload_schema" IN ('decision_table.v1')),
  CONSTRAINT knowledge_ruleset_revisions_table_purpose CHECK (
    "payload_schema" IS DISTINCT FROM 'decision_table.v1'
    OR "purpose" IN ('classification', 'derivation', 'reference_date', 'competence')),
  CONSTRAINT knowledge_ruleset_revisions_territories_bounded CHECK (cardinality("territory_ids") BETWEEN 1 AND 50),
  CONSTRAINT knowledge_ruleset_revisions_works_bounded CHECK (cardinality("work_ids") <= 50),
  CONSTRAINT knowledge_ruleset_revisions_dates_ordered CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  CONSTRAINT knowledge_ruleset_revisions_edition_type CHECK ("basis_edition_type" = 'edition'),
  CONSTRAINT knowledge_ruleset_revisions_inherits_known CHECK ("inherits" IS NULL OR "inherits" = 'parent'),
  -- A table, or a deferral to the parent: exactly one.
  CONSTRAINT knowledge_ruleset_revisions_table_or_inherits CHECK (
    ("inherits" IS NULL AND "payload_schema" IS NOT NULL AND "payload" IS NOT NULL)
    OR ("inherits" IS NOT NULL AND "payload_schema" IS NULL AND "payload" IS NULL)),
  CONSTRAINT knowledge_ruleset_revisions_payload_object CHECK ("payload" IS NULL OR jsonb_typeof("payload") = 'object'),
  CONSTRAINT knowledge_ruleset_revisions_edition_fk FOREIGN KEY ("basis_edition_id", "basis_edition_type")
    REFERENCES "knowledge_records" ("id", "type") ON DELETE CASCADE,
  CONSTRAINT knowledge_ruleset_revisions_revision_fk FOREIGN KEY ("revision_id", "owner_key")
    REFERENCES "knowledge_revisions" ("revision_id", "owner_key") ON DELETE CASCADE,
  CONSTRAINT knowledge_ruleset_revisions_record_fk FOREIGN KEY ("revision_id", "record_id")
    REFERENCES "knowledge_revisions" ("revision_id", "record_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_ruleset_revisions_purpose_idx" ON "knowledge_ruleset_revisions" ("purpose");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_ruleset_revisions_territories_idx" ON "knowledge_ruleset_revisions" USING gin ("territory_ids");
--> statement-breakpoint
-- 0202's cross-owner refusal, now also for the edition a ruleset encodes.
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
  ELSIF TG_TABLE_NAME = 'knowledge_ruleset_revisions' THEN
    target := NEW.basis_edition_id;
    IF target IS NULL THEN
      RETURN NEW;
    END IF;
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
CREATE TRIGGER knowledge_ruleset_revisions_owner BEFORE INSERT ON "knowledge_ruleset_revisions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_refuse_cross_owner();
--> statement-breakpoint
CREATE TRIGGER knowledge_ruleset_revisions_append_only BEFORE UPDATE OR DELETE ON "knowledge_ruleset_revisions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
SELECT secure_table('knowledge_ruleset_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.head_revision_id = revision_id))');
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE 'CREATE POLICY tenant_write_guard_ins ON knowledge_ruleset_revisions AS RESTRICTIVE FOR INSERT WITH CHECK (organization_id = current_org())';
  EXECUTE 'CREATE POLICY tenant_write_guard_upd ON knowledge_ruleset_revisions AS RESTRICTIVE FOR UPDATE USING (organization_id = current_org()) WITH CHECK (organization_id = current_org())';
  EXECUTE 'CREATE POLICY tenant_write_guard_del ON knowledge_ruleset_revisions AS RESTRICTIVE FOR DELETE USING (organization_id = current_org())';
  EXECUTE format('REVOKE UPDATE, DELETE ON knowledge_ruleset_revisions FROM %I, %I', rls_role('rw'), rls_role('platform'));
END $$;
