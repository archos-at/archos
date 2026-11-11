-- Reverse 0218. ORDER: roll the frontend back first; the newer build expects a
-- domain expert's approval on every request and refuses an override over an
-- unchecked pasted page.
--
-- Not lossy: no row is written or removed. The 0214 source check (an override
-- defers it) and the 0212 role list (second_reviewer included) come back.
DROP TRIGGER IF EXISTS knowledge_change_requests_status_moves ON "knowledge_change_requests";
DROP FUNCTION IF EXISTS knowledge_change_request_status_moves();
DROP FUNCTION IF EXISTS knowledge_claims_open(uuid);
CREATE OR REPLACE FUNCTION knowledge_required_approval_roles(request uuid) RETURNS text[]
  LANGUAGE sql STABLE AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN EXISTS (
      SELECT 1 FROM knowledge_revisions r JOIN knowledge_ruleset_revisions b ON b.revision_id = r.revision_id
      WHERE r.change_request_id = request AND b.payload_schema = 'advice_policy.v1') THEN 'counsel' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM knowledge_revisions r JOIN knowledge_source_revisions s ON s.revision_id = r.revision_id
      WHERE r.change_request_id = request AND s.data_flow = 'site_keyed') THEN 'privacy_reviewer' END
  ], NULL)
$$;
-- 0214's source check: every revision of the request, superseded ones included.
CREATE OR REPLACE FUNCTION knowledge_sources_unchecked(request uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM knowledge_revisions r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.provenance -> 'citations') = 'array' THEN r.provenance -> 'citations' ELSE '[]'::jsonb END
    ) AS c(citation)
    JOIN knowledge_citation_captures k ON k.id::text = c.citation ->> 'captureId'
    WHERE r.change_request_id = request
      AND k.basis = 'operator_supplied'
      AND NOT EXISTS (
        SELECT 1 FROM knowledge_review_decisions d
        WHERE d.revision_id = r.revision_id AND d.source_checked AND d.reviewer <> r.created_by
      )
  )
$$;
CREATE OR REPLACE FUNCTION knowledge_approval_sources_checked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.override_reason IS NULL AND knowledge_sources_unchecked(NEW.change_request_id) THEN
    RAISE EXCEPTION 'a revision cites an operator-supplied capture whose source no reviewer checked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
ALTER TABLE "knowledge_approvals" DROP CONSTRAINT IF EXISTS knowledge_approvals_role_known;
ALTER TABLE "knowledge_approvals" ADD CONSTRAINT knowledge_approvals_role_known
  CHECK ("role" IN ('domain_expert', 'counsel', 'second_reviewer', 'privacy_reviewer'));
ALTER TABLE "knowledge_second_reviews" DROP CONSTRAINT IF EXISTS knowledge_second_reviews_role_known;
ALTER TABLE "knowledge_second_reviews" ADD CONSTRAINT knowledge_second_reviews_role_known
  CHECK ("role" IN ('domain_expert', 'counsel', 'second_reviewer', 'privacy_reviewer'));
