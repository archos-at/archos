-- Reverse 0209. ORDER: roll the frontend back first; the newer build reads and
-- writes relations, dated parents and the wider kinds.
--
-- Lossy: every relation record goes, and every territory's dated parents. A
-- work of a kind 0205 did not know stays: its CHECK comes back NOT VALID, so
-- the row survives and only a new one is held to the five kinds.
-- 0205's read policy and entitlement come back, so an office reads what it read before 0209.
SELECT secure_table('knowledge_records',
  'organization_id = current_org() OR (organization_id IS NULL AND head_revision_id IS NOT NULL '
  'AND knowledge_country_entitled(country_id))');
DROP FUNCTION IF EXISTS knowledge_reached_by_relation(text);
CREATE OR REPLACE FUNCTION knowledge_country_entitled(country text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_org() IS NOT NULL AND country IS NOT NULL AND (
    EXISTS (SELECT 1 FROM organizations o WHERE o.workos_organization_id = current_org() AND o.home_country = country)
    OR EXISTS (SELECT 1 FROM organization_countries c WHERE c.organization_id = current_org() AND c.country_id = country))
$$;
DROP TABLE IF EXISTS "knowledge_relation_revisions";
DELETE FROM "knowledge_records" WHERE "type" = 'relation';
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
ALTER TABLE "knowledge_territory_revisions" DROP CONSTRAINT IF EXISTS knowledge_territory_revisions_dated_parents_array;
ALTER TABLE "knowledge_territory_revisions" DROP COLUMN IF EXISTS "dated_parents";
ALTER TABLE "knowledge_work_revisions" DROP CONSTRAINT IF EXISTS knowledge_work_revisions_kind_known;
ALTER TABLE "knowledge_work_revisions" ADD CONSTRAINT knowledge_work_revisions_kind_known CHECK (
  "kind" IN ('technical_standard', 'guideline', 'commentary', 'authority_directive', 'statute')) NOT VALID;
ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_type_known;
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_type_known
  CHECK ("type" IN ('work', 'edition', 'manifestation', 'ruleset', 'territory', 'authority'));
