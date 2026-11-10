-- Four eyes held by the database (architecture review of platform governance;
-- amends ADR-0165, ADR-0170 and ADR-0176).
--
-- - Every change request needs a domain expert's approval. Counsel (an advice
--   policy) and a privacy reviewer (a site-keyed source) come on top where they
--   apply; before, one approval in any role approved a request that needed no
--   other role, legal content included.
-- - A request's status moves only along its lifecycle, and to `approved` only
--   when every role it needs has approved it, no claim's newest verdict is
--   edited or rejected, and every revision it releases carries a verdict (from
--   somebody other than its author, by 0208), unless the domain expert approved
--   alone. Which fields are claims is the application's (`claimsOf`: a body's
--   columns less its keys and the ones left unstated), so "every claim accepted"
--   is the service's check; the database holds the floor under it, and does not
--   copy those rules into SQL where they would drift. A new request starts as a
--   draft.
-- - A request already approved without a domain expert (possible before this
--   migration) could be neither published nor rejected under these rules; the
--   migration refuses to run while one exists and names the way out.
-- - An approval alone no longer defers the source check (ADR-0170): a page an
--   operator pasted is checked against its source by somebody else first.
-- - The `second_reviewer` role is gone: nothing required it, and the second
--   review of an approval alone is given in the role approved alone.
DO $$
DECLARE stuck text;
BEGIN
  SELECT string_agg(r.id::text, ', ') INTO stuck FROM knowledge_change_requests r
  WHERE r.status = 'approved'
    AND NOT EXISTS (SELECT 1 FROM knowledge_approvals a WHERE a.change_request_id = r.id AND a.role = 'domain_expert');
  IF stuck IS NOT NULL THEN
    RAISE EXCEPTION 'change request(s) % are approved without a domain expert; reject them first (UPDATE knowledge_change_requests SET status = ''rejected'', decided_at = now() WHERE id IN (...)), then run this migration and propose them again', stuck;
  END IF;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION knowledge_required_approval_roles(request uuid) RETURNS text[]
  LANGUAGE sql STABLE AS $$
  SELECT array_remove(ARRAY[
    'domain_expert',
    CASE WHEN EXISTS (
      SELECT 1 FROM knowledge_revisions r JOIN knowledge_ruleset_revisions b ON b.revision_id = r.revision_id
      WHERE r.change_request_id = request AND b.payload_schema = 'advice_policy.v1') THEN 'counsel' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM knowledge_revisions r JOIN knowledge_source_revisions s ON s.revision_id = r.revision_id
      WHERE r.change_request_id = request AND s.data_flow = 'site_keyed') THEN 'privacy_reviewer' END
  ], NULL)
$$;
--> statement-breakpoint
-- Whether a request still has a claim that keeps it from approval: a newest
-- verdict that is edited or rejected, or (unless its domain expert approved it
-- alone) a revision it would release that nobody has reviewed.
CREATE OR REPLACE FUNCTION knowledge_claims_open(request uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  WITH released AS (
    SELECT DISTINCT ON (record_id) revision_id FROM knowledge_revisions
    WHERE change_request_id = request ORDER BY record_id, created_at DESC, revision_id DESC
  ), newest AS (
    SELECT DISTINCT ON (d.revision_id, d.claim_path) d.revision_id, d.decision FROM knowledge_review_decisions d
    WHERE d.change_request_id = request ORDER BY d.revision_id, d.claim_path, d.decided_at DESC
  )
  SELECT EXISTS (SELECT 1 FROM newest n JOIN released r USING (revision_id) WHERE n.decision IN ('edited', 'rejected'))
      OR (NOT EXISTS (SELECT 1 FROM knowledge_approvals a WHERE a.change_request_id = request
                      AND a.role = 'domain_expert' AND a.override_reason IS NOT NULL)
          AND EXISTS (SELECT 1 FROM released r WHERE NOT EXISTS (SELECT 1 FROM newest n WHERE n.revision_id = r.revision_id)))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION knowledge_change_request_status_moves() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'a change request starts as a draft, not %', NEW.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF (OLD.status, NEW.status) NOT IN (
    ('draft', 'submitted'), ('draft', 'rejected'), ('submitted', 'approved'), ('submitted', 'rejected'),
    ('approved', 'published'), ('approved', 'rejected'), ('published', 'rolled_back')) THEN
    RAISE EXCEPTION 'a change request does not move from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'rejected' AND NEW.second_review IS DISTINCT FROM 'disputed' THEN
    RAISE EXCEPTION 'an approved change request is rejected only once its second review disputed it' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'approved' THEN
    IF EXISTS (
      SELECT 1 FROM unnest(knowledge_required_approval_roles(NEW.id)) AS needed
      WHERE NOT EXISTS (SELECT 1 FROM knowledge_approvals a WHERE a.change_request_id = NEW.id AND a.role = needed)) THEN
      RAISE EXCEPTION 'a change request is approved only once every role it needs has approved it' USING ERRCODE = 'check_violation';
    END IF;
    IF knowledge_claims_open(NEW.id) THEN
      RAISE EXCEPTION 'a change request is approved only with no claim edited, rejected or unreviewed' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_change_requests_status_moves BEFORE INSERT OR UPDATE OF "status" ON "knowledge_change_requests"
  FOR EACH ROW EXECUTE FUNCTION knowledge_change_request_status_moves();
--> statement-breakpoint
-- The source check reads the revisions a request releases, each record's newest
-- (as `knowledge_claims_open` and the release do): a revision a re-proposal
-- superseded is never released or shown for review, so its citations hold
-- nothing up.
CREATE OR REPLACE FUNCTION knowledge_sources_unchecked(request uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  WITH released AS (
    SELECT DISTINCT ON (record_id) revision_id, created_by, provenance FROM knowledge_revisions
    WHERE change_request_id = request ORDER BY record_id, created_at DESC, revision_id DESC
  )
  SELECT EXISTS (
    SELECT 1
    FROM released r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.provenance -> 'citations') = 'array' THEN r.provenance -> 'citations' ELSE '[]'::jsonb END
    ) AS c(citation)
    JOIN knowledge_citation_captures k ON k.id::text = c.citation ->> 'captureId'
    WHERE k.basis = 'operator_supplied'
      AND NOT EXISTS (
        SELECT 1 FROM knowledge_review_decisions d
        WHERE d.revision_id = r.revision_id AND d.source_checked AND d.reviewer <> r.created_by
      )
  )
$$;
--> statement-breakpoint
-- What nobody fetched, a person checked: for every approval, alone or not (0209 as it was).
CREATE OR REPLACE FUNCTION knowledge_approval_sources_checked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF knowledge_sources_unchecked(NEW.change_request_id) THEN
    RAISE EXCEPTION 'a revision cites an operator-supplied capture whose source no reviewer checked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- NOT VALID: a second_reviewer approval written before stays on the record; no new one is taken.
ALTER TABLE "knowledge_approvals" DROP CONSTRAINT IF EXISTS knowledge_approvals_role_known;
--> statement-breakpoint
ALTER TABLE "knowledge_approvals" ADD CONSTRAINT knowledge_approvals_role_known
  CHECK ("role" IN ('domain_expert', 'counsel', 'privacy_reviewer')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "knowledge_second_reviews" DROP CONSTRAINT IF EXISTS knowledge_second_reviews_role_known;
--> statement-breakpoint
ALTER TABLE "knowledge_second_reviews" ADD CONSTRAINT knowledge_second_reviews_role_known
  CHECK ("role" IN ('domain_expert', 'counsel', 'privacy_reviewer')) NOT VALID;
