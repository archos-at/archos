-- Reverse 0204. ORDER: roll the frontend back first; the newer build reads and
-- writes rulesets.
--
-- Lossy: every ruleset record and its history goes. Nothing in the product
-- decides from a ruleset yet; the coded derivations stay in force either way.
DROP TABLE IF EXISTS "knowledge_ruleset_revisions";
DELETE FROM "knowledge_records" WHERE "type" = 'ruleset';
ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS "knowledge_records_type_known";
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_type_known
  CHECK ("type" IN ('work', 'edition', 'manifestation'));
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
