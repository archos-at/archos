-- One parent field for a territory (design §3.2): `parents`, each
-- `{ "id", "validFrom"?, "validTo"? }`, half-open, an absent date open. It
-- replaces the two lists 0205 and 0211 kept side by side, `parent_ids`
-- (undated) and `dated_parents`, which three readers walked three ways, so the
-- time path's chain never saw `EU`.
--
-- Expand only (ci/migration_contract.py): `parent_ids` and `dated_parents` stay
-- and the BFF keeps writing them, derived from `parents`, so an older build
-- reads what it read before. Nothing reads them any more; a later contract
-- migration drops them once production is past every build that does.
--
-- - `parents` is backfilled from both lists on every stored revision (the
--   append-only trigger is lifted for this one rewrite, as 0212's down migration does).
-- - `knowledge_country_entitled` reads the `EU` membership from `parents`.
--
-- Rollback risk: a build older than 0219 writes `parent_ids` and
-- `dated_parents` only, so a territory revision it writes after 0219 has
-- `parents = []`, and the newer build reads that territory as parentless (no
-- country, no EU) until it is proposed again. Roll back the build only with
-- the down migration, or re-propose every territory written in between.
ALTER TABLE "knowledge_territory_revisions" ADD COLUMN IF NOT EXISTS "parents" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_territory_revisions" ADD CONSTRAINT knowledge_territory_revisions_parents_array
  CHECK (jsonb_typeof("parents") = 'array' AND jsonb_array_length("parents") <= 20);
--> statement-breakpoint
ALTER TABLE "knowledge_territory_revisions" DISABLE TRIGGER knowledge_territory_revisions_append_only;
--> statement-breakpoint
UPDATE "knowledge_territory_revisions" SET "parents" =
  coalesce((SELECT jsonb_agg(jsonb_build_object('id', p) ORDER BY n) FROM unnest("parent_ids") WITH ORDINALITY AS u(p, n)), '[]'::jsonb)
  || "dated_parents";
--> statement-breakpoint
ALTER TABLE "knowledge_territory_revisions" ENABLE TRIGGER knowledge_territory_revisions_append_only;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION knowledge_country_entitled(country text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_org() IS NOT NULL AND country IS NOT NULL AND (
    EXISTS (SELECT 1 FROM organizations o WHERE o.workos_organization_id = current_org() AND o.home_country = country)
    OR EXISTS (SELECT 1 FROM organization_countries c WHERE c.organization_id = current_org() AND c.country_id = country)
    OR (country = 'EU' AND EXISTS (
      SELECT 1 FROM knowledge_records r
      JOIN knowledge_territory_revisions t ON t.revision_id = r.head_revision_id
      WHERE r.organization_id IS NULL AND r.type = 'territory' AND r.id = r.country_id
        AND t.parents @> '[{"id": "EU"}]'::jsonb
        -- A membership that has ended (half-open, ISO dates compare as text) entitles nothing.
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.parents) p
          WHERE p->>'id' = 'EU' AND (p->>'validTo' IS NULL OR p->>'validTo' > to_char(current_date, 'YYYY-MM-DD')))
        AND (EXISTS (SELECT 1 FROM organizations o WHERE o.workos_organization_id = current_org() AND o.home_country = r.country_id)
          OR EXISTS (SELECT 1 FROM organization_countries c WHERE c.organization_id = current_org() AND c.country_id = r.country_id)))))
$$;
