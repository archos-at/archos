-- Reverse 0210. ORDER: roll the frontend back first; the newer build writes
-- source records, monitor requests and the two prompt-facing ruleset types.
--
-- Lossy: every source record goes with its whole history, credential and
-- monitor state; every ruleset that ever held an advice policy or terminology
-- goes with its whole history; a request a monitor opened stays, as a plain
-- draft without its finding; every privacy-reviewer approval goes. Records, not revisions:
-- revisions are append-only and go only with their record, by cascade. Nothing
-- an office reads changes: no turn reads a source record, an advice policy or
-- terminology from the database before this build.
DROP TRIGGER IF EXISTS knowledge_release_moves_required_roles ON "knowledge_release_moves";
DROP FUNCTION IF EXISTS knowledge_publish_has_required_roles();
DROP FUNCTION IF EXISTS knowledge_required_approval_roles(uuid);
-- Approvals are append-only; the trigger is lifted for the one cleanup and put back.
ALTER TABLE "knowledge_approvals" DISABLE TRIGGER knowledge_approvals_append_only;
DELETE FROM "knowledge_approvals" WHERE "role" = 'privacy_reviewer';
ALTER TABLE "knowledge_approvals" ENABLE TRIGGER knowledge_approvals_append_only;
ALTER TABLE "knowledge_approvals" DROP CONSTRAINT IF EXISTS knowledge_approvals_role_known;
ALTER TABLE "knowledge_approvals" ADD CONSTRAINT knowledge_approvals_role_known
  CHECK ("role" IN ('domain_expert', 'counsel', 'second_reviewer'));
DROP TABLE IF EXISTS "knowledge_source_monitor_states";
DROP TABLE IF EXISTS "knowledge_source_credentials";
DROP FUNCTION IF EXISTS knowledge_source_credential_on_source();
DROP INDEX IF EXISTS "knowledge_change_requests_one_open_per_source";
ALTER TABLE "knowledge_change_requests" DROP CONSTRAINT IF EXISTS knowledge_change_requests_monitor_names_source;
ALTER TABLE "knowledge_change_requests" DROP CONSTRAINT IF EXISTS knowledge_change_requests_origin_known;
ALTER TABLE "knowledge_change_requests" DROP COLUMN IF EXISTS "monitor_finding";
ALTER TABLE "knowledge_change_requests" DROP COLUMN IF EXISTS "source_record_id";
ALTER TABLE "knowledge_change_requests" DROP COLUMN IF EXISTS "origin";
DELETE FROM "knowledge_records" WHERE "type" = 'source'
  OR ("type" = 'ruleset' AND "id" IN (
    SELECT "record_id" FROM "knowledge_ruleset_revisions" WHERE "payload_schema" IN ('advice_policy.v1', 'terminology.v1')));
DROP TABLE IF EXISTS "knowledge_source_revisions";
ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_platform_types;
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_platform_types
  CHECK ("type" NOT IN ('territory', 'authority') OR "organization_id" IS NULL);
ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_type_known;
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_type_known
  CHECK ("type" IN ('work', 'edition', 'manifestation', 'ruleset', 'territory', 'authority'));
ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_prompt_purpose;
ALTER TABLE "knowledge_ruleset_revisions" DROP CONSTRAINT IF EXISTS knowledge_ruleset_revisions_schema_known;
ALTER TABLE "knowledge_ruleset_revisions" ADD CONSTRAINT knowledge_ruleset_revisions_schema_known CHECK (
  "payload_schema" IS NULL OR "payload_schema" IN ('decision_table.v1', 'fact_definitions.v1', 'fact_sources.v1'));
