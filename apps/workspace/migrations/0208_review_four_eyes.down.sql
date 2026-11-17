-- Reverse 0208. ORDER: roll the frontend back first; the newer build writes
-- the decision source. Lossless apart from that column: verdicts keep their
-- reviewer and decision, and an author may review again.
CREATE OR REPLACE FUNCTION knowledge_review_in_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM knowledge_revisions
                 WHERE revision_id = NEW.revision_id AND change_request_id = NEW.change_request_id) THEN
    RAISE EXCEPTION 'a review decision names a revision of its own change request' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
ALTER TABLE "knowledge_review_decisions" DROP CONSTRAINT IF EXISTS knowledge_review_decisions_source_given;
ALTER TABLE "knowledge_review_decisions" DROP CONSTRAINT IF EXISTS knowledge_review_decisions_source_known;
ALTER TABLE "knowledge_review_decisions" DROP COLUMN IF EXISTS "decision_source";
