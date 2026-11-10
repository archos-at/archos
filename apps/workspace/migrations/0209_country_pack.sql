-- 0209: what a country pack needs beyond 0205's records (ADR-0168).
--
-- ## What was missing
--
-- 0205 let the platform hold works, editions, copies, territories and
-- authorities, but nothing said how one instrument makes another binding. So
-- the OIB-Richtlinien 2023 counted as binding in every Land (defect 7 of
-- `docs/design/international/design.md` §2.2), although Steiermark still binds
-- the 2019 edition and Tirol adopted RL 6 in its 2025 edition. Which edition
-- binds where was prose in a system prompt and a regex over hosts in
-- `citations/binding.py`. Design §3.5 and §8.3; build split S8.
--
-- ## The shape
--
-- - `relation` joins the record types, with its typed body
--   `knowledge_relation_revisions`: one `from` and one `to` (a work or an
--   edition), the type (`makes_binding`, `supersedes`, `deviates_from`,
--   `interprets`), the mode of a `makes_binding` (`declared`,
--   `static_reference`, `dynamic_reference`), paired anchors, the provision
--   that says so, and the half-open interval it is in force. Append-only like
--   every body; an office may own one (its route then reads
--   `office_maintained`), and a platform relation names platform records only.
-- - Every kind of design §3.5 joins the work-kind CHECK. An office still holds
--   five (the office service's own list); the platform holds all ten.
-- - A territory's dated parents (`dated_parents`): `AT` lies in `EU` from
--   1995-01-01, `GB` lay in it until 2020-12-31. `parent_ids` stays the
--   undated parents, so 0205's directive chain reads what it read before.
--
-- ## Reads
--
-- The `EU` pack follows any member: an office reads `EU` records when it is
-- entitled to a country whose released territory record names `EU` as a dated
-- parent. A record of another pack is readable when a released platform
-- relation reaches it from a record the office may read (design §3.5,
-- "resolution across packs": Liechtenstein's fire law reaches SIA norms with no
-- Swiss entitlement). Both are SECURITY DEFINER functions that walk from the
-- record being read, never from everything an office holds, so the row policy
-- stays one indexed probe per hop. No route, no read: unknown fails closed.

ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_type_known;
--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_type_known
  CHECK ("type" IN ('work', 'edition', 'manifestation', 'ruleset', 'territory', 'authority', 'relation'));
--> statement-breakpoint
ALTER TABLE "knowledge_work_revisions" DROP CONSTRAINT IF EXISTS knowledge_work_revisions_kind_known;
--> statement-breakpoint
ALTER TABLE "knowledge_work_revisions" ADD CONSTRAINT knowledge_work_revisions_kind_known CHECK (
  "kind" IN ('statute', 'ordinance', 'administrative_regulation', 'directive', 'intergovernmental_agreement',
             'model_code', 'technical_standard', 'guideline', 'commentary', 'authority_directive'));
--> statement-breakpoint
-- `[{ "id": "EU", "validFrom": "1995-01-01" }]`: a parent for an interval only, half-open.
ALTER TABLE "knowledge_territory_revisions" ADD COLUMN IF NOT EXISTS "dated_parents" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_territory_revisions" ADD CONSTRAINT knowledge_territory_revisions_dated_parents_array
  CHECK (jsonb_typeof("dated_parents") = 'array' AND jsonb_array_length("dated_parents") <= 10);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_relation_revisions" (
  "revision_id" uuid PRIMARY KEY NOT NULL,
  "record_id" text NOT NULL,
  "organization_id" text,
  "owner_key" text GENERATED ALWAYS AS (coalesce("organization_id", '')) STORED NOT NULL,
  "relation_type" text NOT NULL,
  -- Only a `makes_binding` has a mode: declared (the WBTV declares OIB-RL 2),
  -- a static reference to one edition, or a dynamic one to the work's edition in force.
  "mode" text,
  "from_id" text NOT NULL,
  "from_type" text NOT NULL,
  "to_id" text NOT NULL,
  "to_type" text NOT NULL,
  -- Paired clauses, AKN eIds: `[{ "from": "par_4", "to": "pkt_3.1" }]`. Empty means the whole instrument.
  "anchors" jsonb DEFAULT '[]'::jsonb NOT NULL,
  -- Where the from-instrument says so, as it is cited: "§ 1 WBTV 2023".
  "provision" text,
  "valid_from" date,
  "valid_to" date,
  CONSTRAINT knowledge_relation_revisions_type_known CHECK (
    "relation_type" IN ('makes_binding', 'supersedes', 'deviates_from', 'interprets')),
  CONSTRAINT knowledge_relation_revisions_mode_known CHECK (
    "mode" IS NULL OR "mode" IN ('declared', 'static_reference', 'dynamic_reference')),
  CONSTRAINT knowledge_relation_revisions_mode_iff_binding CHECK (("mode" IS NOT NULL) = ("relation_type" = 'makes_binding')),
  CONSTRAINT knowledge_relation_revisions_from_type CHECK ("from_type" IN ('work', 'edition')),
  CONSTRAINT knowledge_relation_revisions_to_type CHECK ("to_type" IN ('work', 'edition')),
  CONSTRAINT knowledge_relation_revisions_not_self CHECK ("from_id" <> "to_id"),
  CONSTRAINT knowledge_relation_revisions_anchors_array CHECK (
    jsonb_typeof("anchors") = 'array' AND jsonb_array_length("anchors") <= 50),
  -- A displacement names the clauses it displaces.
  CONSTRAINT knowledge_relation_revisions_deviation_anchored CHECK (
    "relation_type" <> 'deviates_from' OR jsonb_array_length("anchors") >= 1),
  CONSTRAINT knowledge_relation_revisions_provision_bounded CHECK ("provision" IS NULL OR char_length("provision") BETWEEN 1 AND 120),
  CONSTRAINT knowledge_relation_revisions_dates_ordered CHECK (
    "valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" > "valid_from"),
  CONSTRAINT knowledge_relation_revisions_from_fk FOREIGN KEY ("from_id", "from_type")
    REFERENCES "knowledge_records" ("id", "type"),
  CONSTRAINT knowledge_relation_revisions_to_fk FOREIGN KEY ("to_id", "to_type")
    REFERENCES "knowledge_records" ("id", "type"),
  CONSTRAINT knowledge_relation_revisions_revision_fk FOREIGN KEY ("revision_id", "owner_key")
    REFERENCES "knowledge_revisions" ("revision_id", "owner_key") ON DELETE CASCADE,
  CONSTRAINT knowledge_relation_revisions_record_fk FOREIGN KEY ("revision_id", "record_id")
    REFERENCES "knowledge_revisions" ("revision_id", "record_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_relation_revisions_to_idx" ON "knowledge_relation_revisions" ("to_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_relation_revisions_from_idx" ON "knowledge_relation_revisions" ("from_id");
--> statement-breakpoint
-- 0204's cross-owner refusal, now also for both ends of a relation: a platform
-- relation names platform records only; an office one names its own or the platform's.
CREATE OR REPLACE FUNCTION knowledge_refuse_cross_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  targets text[];
  target text;
  target_owner text;
  found_target boolean;
BEGIN
  IF TG_TABLE_NAME = 'knowledge_edition_revisions' THEN
    targets := ARRAY[NEW.work_id];
  ELSIF TG_TABLE_NAME = 'knowledge_manifestation_revisions' THEN
    targets := ARRAY[NEW.edition_id];
  ELSIF TG_TABLE_NAME = 'knowledge_ruleset_revisions' THEN
    IF NEW.basis_edition_id IS NULL THEN
      RETURN NEW;
    END IF;
    targets := ARRAY[NEW.basis_edition_id];
  ELSIF TG_TABLE_NAME = 'knowledge_relation_revisions' THEN
    targets := ARRAY[NEW.from_id, NEW.to_id];
  ELSE
    RETURN NEW;
  END IF;
  FOREACH target IN ARRAY targets LOOP
    found_target := NULL;
    SELECT true, organization_id INTO found_target, target_owner FROM knowledge_records WHERE id = target;
    IF found_target IS NULL THEN
      RAISE EXCEPTION 'knowledge record % is not visible to this owner', target USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF target_owner IS NOT NULL AND target_owner IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'knowledge record % belongs to another owner', target USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_relation_revisions_owner BEFORE INSERT ON "knowledge_relation_revisions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_refuse_cross_owner();
--> statement-breakpoint
CREATE TRIGGER knowledge_relation_revisions_append_only BEFORE UPDATE OR DELETE ON "knowledge_relation_revisions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
-- 0205's entitlement, plus the `EU` pack: it follows any entitled member, a
-- country whose released territory record names `EU` as a dated parent.
CREATE OR REPLACE FUNCTION knowledge_country_entitled(country text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_org() IS NOT NULL AND country IS NOT NULL AND (
    EXISTS (SELECT 1 FROM organizations o WHERE o.workos_organization_id = current_org() AND o.home_country = country)
    OR EXISTS (SELECT 1 FROM organization_countries c WHERE c.organization_id = current_org() AND c.country_id = country)
    OR (country = 'EU' AND EXISTS (
      SELECT 1 FROM knowledge_records r
      JOIN knowledge_territory_revisions t ON t.revision_id = r.head_revision_id
      WHERE r.organization_id IS NULL AND r.type = 'territory' AND r.id = r.country_id
        AND t.dated_parents @> '[{"id": "EU"}]'::jsonb
        -- A membership that has ended (half-open, ISO dates compare as text) entitles nothing.
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.dated_parents) p
          WHERE p->>'id' = 'EU' AND (p->>'validTo' IS NULL OR p->>'validTo' > to_char(current_date, 'YYYY-MM-DD')))
        AND (EXISTS (SELECT 1 FROM organizations o WHERE o.workos_organization_id = current_org() AND o.home_country = r.country_id)
          OR EXISTS (SELECT 1 FROM organization_countries c WHERE c.organization_id = current_org() AND c.country_id = r.country_id)))))
$$;
--> statement-breakpoint
-- Whether a released platform relation reaches this platform record from one
-- the current office is entitled to (design §3.5, resolution across packs).
-- Walks backwards from the record: the relations that point at it, at its
-- work (for an edition) or at one of its editions (for a work), then their
-- from-instruments, at most eight hops. A relation record is reached when its
-- from-instrument is.
CREATE OR REPLACE FUNCTION knowledge_reached_by_relation(target text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE ends(id, depth) AS (
    -- A relation is read through its from-instrument, one hop away.
    SELECT coalesce(x.from_id, target), CASE WHEN x.from_id IS NULL THEN 0 ELSE 1 END
    FROM (SELECT 1) seed
    LEFT JOIN knowledge_records r ON r.id = target AND r.type = 'relation' AND r.organization_id IS NULL
    LEFT JOIN knowledge_relation_revisions x ON x.revision_id = r.head_revision_id
    UNION
    SELECT step.id, step.depth FROM ends CROSS JOIN LATERAL (
      -- An edition is reached where its work is, and a work where one of its editions is.
      SELECT e.work_id AS id, ends.depth AS depth
      FROM knowledge_records r JOIN knowledge_edition_revisions e ON e.revision_id = r.head_revision_id
      WHERE r.id = ends.id AND r.type = 'edition' AND r.organization_id IS NULL
      UNION ALL
      SELECT r.id, ends.depth
      FROM knowledge_edition_revisions e JOIN knowledge_records r ON r.head_revision_id = e.revision_id
      WHERE e.work_id = ends.id AND r.type = 'edition' AND r.organization_id IS NULL
      UNION ALL
      -- One hop back along a released platform relation that points here.
      SELECT x.from_id, ends.depth + 1
      FROM knowledge_relation_revisions x
      JOIN knowledge_records rr ON rr.id = x.record_id AND rr.head_revision_id = x.revision_id AND rr.organization_id IS NULL
      WHERE x.to_id = ends.id AND ends.depth < 8 AND x.relation_type IN ('makes_binding', 'deviates_from', 'interprets')
    ) step
  )
  SELECT current_org() IS NOT NULL AND EXISTS (
    SELECT 1 FROM ends JOIN knowledge_records r ON r.id = ends.id
    WHERE ends.depth > 0 AND r.organization_id IS NULL AND r.head_revision_id IS NOT NULL
      AND knowledge_country_entitled(r.country_id))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION knowledge_reached_by_relation(text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION knowledge_reached_by_relation(text) TO %I, %I', rls_role('rw'), rls_role('platform'));
END $$;
--> statement-breakpoint
-- 0205's layered read, widened to records a released relation reaches.
SELECT secure_table('knowledge_records',
  'organization_id = current_org() OR (organization_id IS NULL AND head_revision_id IS NOT NULL '
  'AND (knowledge_country_entitled(country_id) OR knowledge_reached_by_relation(id)))');
--> statement-breakpoint
SELECT secure_table('knowledge_relation_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND knowledge_revision_released(revision_id) '
  'AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.id = record_id))');
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE 'CREATE POLICY tenant_write_guard_ins ON knowledge_relation_revisions AS RESTRICTIVE FOR INSERT WITH CHECK (organization_id = current_org())';
  EXECUTE 'CREATE POLICY tenant_write_guard_upd ON knowledge_relation_revisions AS RESTRICTIVE FOR UPDATE USING (organization_id = current_org()) WITH CHECK (organization_id = current_org())';
  EXECUTE 'CREATE POLICY tenant_write_guard_del ON knowledge_relation_revisions AS RESTRICTIVE FOR DELETE USING (organization_id = current_org())';
  EXECUTE format('REVOKE UPDATE, DELETE ON knowledge_relation_revisions FROM %I, %I', rls_role('rw'), rls_role('platform'));
END $$;
