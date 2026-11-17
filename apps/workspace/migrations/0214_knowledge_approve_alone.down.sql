-- Reverse 0214. ORDER: roll the frontend back first; the newer build writes
-- override approvals and reads `approval` and `second_review`.
--
-- Lossy: every override reason, every second review given, and the record of
-- which requests were approved alone and whether their second review closed.
-- A preview a disputed request retracted stays retracted. The override approvals stay as
-- plain approvals by an author, which 0205's trigger would never have let in.
CREATE OR REPLACE FUNCTION knowledge_release_move_allowed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_status text;
BEGIN
  SELECT status INTO request_status FROM knowledge_change_requests WHERE id = NEW.change_request_id;
  IF NEW.action = 'publish' THEN
    IF request_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'only an approved change request is published' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM knowledge_revisions
                   WHERE revision_id = NEW.to_revision_id AND change_request_id = NEW.change_request_id) THEN
      RAISE EXCEPTION 'a publish releases a revision of its own change request' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF request_status IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'only a published change request is rolled back' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS knowledge_change_requests_second_review ON "knowledge_change_requests";
DROP FUNCTION IF EXISTS knowledge_second_review_moves();
DROP TABLE IF EXISTS "knowledge_second_reviews";
DROP FUNCTION IF EXISTS knowledge_second_review_closes();
DROP FUNCTION IF EXISTS knowledge_second_review_given();
DROP FUNCTION IF EXISTS knowledge_second_review_owed(uuid);
DROP TRIGGER IF EXISTS knowledge_approvals_override_marks ON "knowledge_approvals";
DROP FUNCTION IF EXISTS knowledge_approval_override_marks();
CREATE OR REPLACE FUNCTION knowledge_approval_sources_checked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF knowledge_sources_unchecked(NEW.change_request_id) THEN
    RAISE EXCEPTION 'a revision cites an operator-supplied capture whose source no reviewer checked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE OR REPLACE FUNCTION knowledge_approval_four_eyes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM knowledge_change_requests WHERE id = NEW.change_request_id AND status = 'submitted') THEN
    RAISE EXCEPTION 'only a submitted change request is approved' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM knowledge_revisions WHERE change_request_id = NEW.change_request_id AND created_by = NEW.approver) THEN
    RAISE EXCEPTION 'an approver may not approve a change request holding a revision they wrote' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP INDEX IF EXISTS "knowledge_change_requests_second_review_due_idx";
ALTER TABLE "knowledge_change_requests" DROP CONSTRAINT IF EXISTS knowledge_change_requests_second_review_closed_by;
ALTER TABLE "knowledge_change_requests" DROP CONSTRAINT IF EXISTS knowledge_change_requests_single_owes_review;
ALTER TABLE "knowledge_change_requests" DROP CONSTRAINT IF EXISTS knowledge_change_requests_second_review_known;
ALTER TABLE "knowledge_change_requests" DROP CONSTRAINT IF EXISTS knowledge_change_requests_approval_known;
ALTER TABLE "knowledge_change_requests" DROP COLUMN IF EXISTS "second_review_at";
ALTER TABLE "knowledge_change_requests" DROP COLUMN IF EXISTS "second_review_by";
ALTER TABLE "knowledge_change_requests" DROP COLUMN IF EXISTS "second_review";
ALTER TABLE "knowledge_change_requests" DROP COLUMN IF EXISTS "approval";
ALTER TABLE "knowledge_approvals" DROP CONSTRAINT IF EXISTS knowledge_approvals_override_reasoned;
ALTER TABLE "knowledge_approvals" DROP COLUMN IF EXISTS "override_reason";
