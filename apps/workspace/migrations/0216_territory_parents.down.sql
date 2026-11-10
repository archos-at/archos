-- Reverse 0216. ORDER: roll the frontend back first; the newer build reads `parents`.
--
-- Lossless while the newer build ran: it kept writing `parent_ids` and
-- `dated_parents` beside `parents`.
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
ALTER TABLE "knowledge_territory_revisions" DROP CONSTRAINT IF EXISTS knowledge_territory_revisions_parents_array;
ALTER TABLE "knowledge_territory_revisions" DROP COLUMN IF EXISTS "parents";
