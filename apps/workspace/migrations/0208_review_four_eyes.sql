-- Four eyes on the claim review too (ADR-0165). 0205 kept an author from
-- approving their own change request, but not from reviewing its claims: the
-- author, or the author's agent, could accept every claim, and the approver's
-- "every claim accepted" then rested on the author's word.
--
-- - A verdict never comes from somebody who wrote a revision in the request
--   (the same rule as `knowledge_approval_four_eyes`).
-- - A verdict says how it was given: `app` or `elicitation` (the person's own
--   yes, as on approvals), or `agent` (an agent's call the person did not
--   confirm). Verdicts are append-only, so the rows written before this
--   migration keep NULL; the NOT VALID check holds every new row to a source.
ALTER TABLE "knowledge_review_decisions" ADD COLUMN IF NOT EXISTS "decision_source" text;
--> statement-breakpoint
ALTER TABLE "knowledge_review_decisions" ADD CONSTRAINT knowledge_review_decisions_source_known
  CHECK ("decision_source" IN ('app', 'elicitation', 'agent'));
--> statement-breakpoint
ALTER TABLE "knowledge_review_decisions" ADD CONSTRAINT knowledge_review_decisions_source_given
  CHECK ("decision_source" IS NOT NULL) NOT VALID;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION knowledge_review_in_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM knowledge_revisions
                 WHERE revision_id = NEW.revision_id AND change_request_id = NEW.change_request_id) THEN
    RAISE EXCEPTION 'a review decision names a revision of its own change request' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM knowledge_revisions WHERE change_request_id = NEW.change_request_id AND created_by = NEW.reviewer) THEN
    RAISE EXCEPTION 'a reviewer may not review a change request holding a revision they wrote' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
