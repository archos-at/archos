-- A reviewed dev release carried to production once by the promotion (ADR-0181,
-- amending ADR-0176). Additive: a column, wider CHECKs, two guard triggers.
--
-- - `knowledge_change_requests.carried_from`: where a carried request came
--   from: the bundle's sha256 (of its uncompressed JSON), the deployment that
--   released it, that deployment's release seq, and the promotion that carried
--   it (the image tag). NULL for every request a person opened here. Written
--   with the request and never changed.
-- - `decision_source = 'carried'` on a verdict, an approval and a release move:
--   the decision was made on the source deployment and carried here by the
--   promotion's carry Job (`bff/base-knowledge/platform/carry.ts`), not given
--   by a person on this one. Only a carried request takes it: a trigger refuses
--   `carried` on any other, so the word cannot be borrowed to skip a person.
--
-- `organization_countries.decision_source` keeps its two values: a carry
-- entitles nobody.
ALTER TABLE "knowledge_change_requests" ADD COLUMN IF NOT EXISTS "carried_from" jsonb;
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" DROP CONSTRAINT IF EXISTS knowledge_change_requests_carried_from_shape;
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" ADD CONSTRAINT knowledge_change_requests_carried_from_shape CHECK (
  "carried_from" IS NULL OR (
    jsonb_typeof("carried_from") = 'object'
    AND ("carried_from" ->> 'sha256') ~ '^[0-9a-f]{64}$'
    AND char_length(coalesce("carried_from" ->> 'sourceDeployment', '')) BETWEEN 1 AND 40
    AND jsonb_typeof("carried_from" -> 'sourceSeq') = 'number'
    AND char_length(coalesce("carried_from" ->> 'promotion', '')) BETWEEN 1 AND 200
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_change_requests_carried_idx"
  ON "knowledge_change_requests" (("carried_from" ->> 'sha256')) WHERE "carried_from" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_approvals" DROP CONSTRAINT IF EXISTS knowledge_approvals_source_known;
--> statement-breakpoint
ALTER TABLE "knowledge_approvals" ADD CONSTRAINT knowledge_approvals_source_known
  CHECK ("decision_source" IN ('app', 'elicitation', 'carried'));
--> statement-breakpoint
ALTER TABLE "knowledge_release_moves" DROP CONSTRAINT IF EXISTS knowledge_release_moves_source_known;
--> statement-breakpoint
ALTER TABLE "knowledge_release_moves" ADD CONSTRAINT knowledge_release_moves_source_known
  CHECK ("decision_source" IN ('app', 'elicitation', 'carried'));
--> statement-breakpoint
ALTER TABLE "knowledge_review_decisions" DROP CONSTRAINT IF EXISTS knowledge_review_decisions_source_known;
--> statement-breakpoint
ALTER TABLE "knowledge_review_decisions" ADD CONSTRAINT knowledge_review_decisions_source_known
  CHECK ("decision_source" IN ('app', 'elicitation', 'agent', 'carried'));
--> statement-breakpoint
-- `carried` only on a carried request: a verdict, an approval or a release move of any other is refused.
CREATE OR REPLACE FUNCTION knowledge_carried_only_on_a_carry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.decision_source = 'carried' AND NOT EXISTS (
    SELECT 1 FROM knowledge_change_requests WHERE id = NEW.change_request_id AND carried_from IS NOT NULL) THEN
    RAISE EXCEPTION 'a decision is carried only on a change request carried from another deployment' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS knowledge_approvals_carried ON "knowledge_approvals";
--> statement-breakpoint
CREATE TRIGGER knowledge_approvals_carried BEFORE INSERT ON "knowledge_approvals"
  FOR EACH ROW WHEN (NEW.decision_source = 'carried') EXECUTE FUNCTION knowledge_carried_only_on_a_carry();
--> statement-breakpoint
DROP TRIGGER IF EXISTS knowledge_release_moves_carried ON "knowledge_release_moves";
--> statement-breakpoint
CREATE TRIGGER knowledge_release_moves_carried BEFORE INSERT ON "knowledge_release_moves"
  FOR EACH ROW WHEN (NEW.decision_source = 'carried') EXECUTE FUNCTION knowledge_carried_only_on_a_carry();
--> statement-breakpoint
DROP TRIGGER IF EXISTS knowledge_review_decisions_carried ON "knowledge_review_decisions";
--> statement-breakpoint
CREATE TRIGGER knowledge_review_decisions_carried BEFORE INSERT ON "knowledge_review_decisions"
  FOR EACH ROW WHEN (NEW.decision_source = 'carried') EXECUTE FUNCTION knowledge_carried_only_on_a_carry();
--> statement-breakpoint
-- Where a request came from is part of its record: set with it, never changed after.
CREATE OR REPLACE FUNCTION knowledge_carried_from_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.carried_from IS DISTINCT FROM OLD.carried_from THEN
    RAISE EXCEPTION 'where a change request was carried from is set when it is opened, never changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS knowledge_change_requests_carried_from_fixed ON "knowledge_change_requests";
--> statement-breakpoint
CREATE TRIGGER knowledge_change_requests_carried_from_fixed BEFORE UPDATE OF "carried_from" ON "knowledge_change_requests"
  FOR EACH ROW EXECUTE FUNCTION knowledge_carried_from_fixed();
