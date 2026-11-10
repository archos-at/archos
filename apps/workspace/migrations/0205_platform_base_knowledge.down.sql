-- Reverse 0205. ORDER: roll the frontend back first; the newer build reads and
-- writes these tables and columns.
--
-- Lossy: every platform record (territories, authorities, listings, texts),
-- every change request, review verdict, approval, release move and index run,
-- and every office's country entitlements go. Office records are untouched:
-- they never carry a country, a change request or a corpus file. 0202's read
-- policies come back, so an office reads what it read before 0205.
DELETE FROM "knowledge_records" WHERE "organization_id" IS NULL;
-- 0202's read policies first: the 0205 ones name the columns and functions dropped below.
SELECT secure_table('knowledge_records',
  'organization_id = current_org() OR (organization_id IS NULL AND head_revision_id IS NOT NULL)');
SELECT secure_table('knowledge_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.head_revision_id = revision_id))');
SELECT secure_table('knowledge_work_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.head_revision_id = revision_id))');
SELECT secure_table('knowledge_edition_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.head_revision_id = revision_id))');
SELECT secure_table('knowledge_manifestation_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.head_revision_id = revision_id))');
SELECT secure_table('knowledge_checks', 'organization_id = current_org() OR organization_id IS NULL');
DROP TABLE IF EXISTS "knowledge_index_runs";
DROP TABLE IF EXISTS "knowledge_release_moves";
DROP TABLE IF EXISTS "knowledge_approvals";
DROP TABLE IF EXISTS "knowledge_review_decisions";
DROP TABLE IF EXISTS "knowledge_authority_revisions";
DROP TABLE IF EXISTS "knowledge_territory_revisions";
DROP TRIGGER IF EXISTS knowledge_records_platform_head ON "knowledge_records";
DROP TRIGGER IF EXISTS knowledge_records_platform_born ON "knowledge_records";
DROP TRIGGER IF EXISTS knowledge_revisions_into_draft ON "knowledge_revisions";
ALTER TABLE "knowledge_revisions" DROP CONSTRAINT IF EXISTS knowledge_revisions_change_request_is_platform;
ALTER TABLE "knowledge_revisions" DROP COLUMN IF EXISTS "change_request_id";
DROP TABLE IF EXISTS "knowledge_change_requests";
DROP TABLE IF EXISTS "organization_countries";
ALTER TABLE "knowledge_manifestation_revisions" DROP CONSTRAINT IF EXISTS knowledge_manifestation_revisions_corpus_is_platform;
ALTER TABLE "knowledge_manifestation_revisions" DROP COLUMN IF EXISTS "corpus_file";
DROP INDEX IF EXISTS "knowledge_records_country_type_idx";
ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_country_format;
ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_country_is_platform;
ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_platform_types;
ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_type_known;
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_type_known
  CHECK ("type" IN ('work', 'edition', 'manifestation'));
CREATE OR REPLACE FUNCTION knowledge_records_head_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.organization_id, NEW.type, NEW.document_id, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.organization_id, OLD.type, OLD.document_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'only head_revision_id of a knowledge record changes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
ALTER TABLE "knowledge_records" DROP COLUMN IF EXISTS "country_id";
DROP FUNCTION IF EXISTS knowledge_revision_released(uuid);
DROP FUNCTION IF EXISTS knowledge_country_entitled(text);
DROP FUNCTION IF EXISTS knowledge_platform_head_follows_release();
DROP FUNCTION IF EXISTS knowledge_platform_born_unreleased();
DROP FUNCTION IF EXISTS knowledge_revision_into_draft();
DROP FUNCTION IF EXISTS knowledge_approval_four_eyes();
DROP FUNCTION IF EXISTS knowledge_review_in_request();
DROP FUNCTION IF EXISTS knowledge_release_move_allowed();
