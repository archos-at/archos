-- Approve alone, review later (ADR-0176, amending ADR-0165 and ADR-0170).
--
-- Four eyes holds a platform change request until another person approves it.
-- When the platform owner is the only reviewer there is, they may approve
-- their own request with an explicit override: a reason, and the permission
-- `platform:knowledge:approve_alone` the service checks. The second review is
-- deferred, not removed: the request is marked `approval = 'single'` and a
-- second review is `due` until another person confirms or disputes it.
--
-- - `knowledge_approvals.override_reason`: set only on an override, at least
--   20 characters. The four-eyes trigger lets an author's approval through only
--   with it, and refuses it from anyone who is no author (nothing to override).
-- - An override marks its request in the same statement (AFTER INSERT): no path
--   writes an override without the mark.
-- - The source-check trigger (0209) waits for the second review on an override:
--   `knowledge_sources_unchecked` is the one test, and the confirmation of the
--   second review is held to it.
-- - The second review owes every role approved alone: one row per role in
--   `knowledge_second_reviews`, given by somebody who wrote nothing in the
--   request (the service checks they hold the role). A dispute in any role
--   disputes the request; it is confirmed once every owed role is.
-- - `second_review` on the request follows those rows: `due` → `confirmed` or
--   `disputed`, or `void` when the request is rejected before it was approved
--   (nothing of it reached an office), never back.
-- - A disputed request publishes nothing more; its preview may be retracted
--   (a preview rollback) so it can be rejected.
ALTER TABLE "knowledge_approvals" ADD COLUMN IF NOT EXISTS "override_reason" text;
--> statement-breakpoint
ALTER TABLE "knowledge_approvals" ADD CONSTRAINT knowledge_approvals_override_reasoned
  CHECK ("override_reason" IS NULL OR char_length(btrim("override_reason")) >= 20);
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" ADD COLUMN IF NOT EXISTS "approval" text DEFAULT 'four_eyes' NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" ADD COLUMN IF NOT EXISTS "second_review" text;
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" ADD COLUMN IF NOT EXISTS "second_review_by" text;
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" ADD COLUMN IF NOT EXISTS "second_review_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" ADD CONSTRAINT knowledge_change_requests_approval_known
  CHECK ("approval" IN ('four_eyes', 'single'));
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" ADD CONSTRAINT knowledge_change_requests_second_review_known
  CHECK ("second_review" IN ('due', 'confirmed', 'disputed', 'void'));
--> statement-breakpoint
-- A single approval always owes a second review, and only a single approval does.
ALTER TABLE "knowledge_change_requests" ADD CONSTRAINT knowledge_change_requests_single_owes_review
  CHECK (("approval" = 'single') = ("second_review" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" ADD CONSTRAINT knowledge_change_requests_second_review_closed_by
  CHECK ("second_review" IS DISTINCT FROM 'due' AND "second_review" IS NOT NULL
         AND "second_review_by" IS NOT NULL AND "second_review_at" IS NOT NULL
      OR ("second_review" IS NULL OR "second_review" = 'due') AND "second_review_by" IS NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_change_requests_second_review_due_idx"
  ON "knowledge_change_requests" ("created_at" DESC) WHERE "second_review" = 'due';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION knowledge_approval_four_eyes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE authored boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM knowledge_change_requests WHERE id = NEW.change_request_id AND status = 'submitted') THEN
    RAISE EXCEPTION 'only a submitted change request is approved' USING ERRCODE = 'check_violation';
  END IF;
  authored := EXISTS (SELECT 1 FROM knowledge_revisions WHERE change_request_id = NEW.change_request_id AND created_by = NEW.approver);
  IF authored AND NEW.override_reason IS NULL THEN
    RAISE EXCEPTION 'an approver may not approve a change request holding a revision they wrote' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT authored AND NEW.override_reason IS NOT NULL THEN
    RAISE EXCEPTION 'an override approval is for an author of the change request' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- The 0209 test as one function: a revision cites an operator-supplied capture
-- whose source nobody but its author checked.
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION knowledge_approval_sources_checked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- An override defers the source check to the second review, which is held to it.
  IF NEW.override_reason IS NULL AND knowledge_sources_unchecked(NEW.change_request_id) THEN
    RAISE EXCEPTION 'a revision cites an operator-supplied capture whose source no reviewer checked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION knowledge_approval_override_marks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE knowledge_change_requests SET approval = 'single', second_review = 'due'
  WHERE id = NEW.change_request_id AND second_review IS NULL;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_approvals_override_marks AFTER INSERT ON "knowledge_approvals"
  FOR EACH ROW WHEN (NEW.override_reason IS NOT NULL) EXECUTE FUNCTION knowledge_approval_override_marks();
--> statement-breakpoint
-- One second review per role approved alone: confirmed or disputed, append-only.
CREATE TABLE IF NOT EXISTS "knowledge_second_reviews" (
  "id" uuid PRIMARY KEY NOT NULL,
  "change_request_id" uuid NOT NULL REFERENCES "knowledge_change_requests" ("id"),
  "role" text NOT NULL,
  "decision" text NOT NULL,
  "reviewer" text NOT NULL,
  "decision_source" text NOT NULL,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT knowledge_second_reviews_role_known CHECK ("role" IN ('domain_expert', 'counsel', 'second_reviewer', 'privacy_reviewer')),
  CONSTRAINT knowledge_second_reviews_decision_known CHECK ("decision" IN ('confirmed', 'disputed')),
  CONSTRAINT knowledge_second_reviews_source_known CHECK ("decision_source" IN ('app', 'elicitation')),
  CONSTRAINT knowledge_second_reviews_once UNIQUE ("change_request_id", "role")
);
--> statement-breakpoint
CREATE TRIGGER knowledge_second_reviews_append_only BEFORE UPDATE OR DELETE ON "knowledge_second_reviews"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
-- The roles a request still owes a second review in: each role approved alone with no confirmation yet.
CREATE OR REPLACE FUNCTION knowledge_second_review_owed(request uuid) RETURNS text[]
  LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(DISTINCT a.role ORDER BY a.role), '{}') FROM knowledge_approvals a
  WHERE a.change_request_id = request AND a.override_reason IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM knowledge_second_reviews s
                    WHERE s.change_request_id = request AND s.role = a.role AND s.decision = 'confirmed')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION knowledge_second_review_moves() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.approval IS DISTINCT FROM OLD.approval AND NOT (OLD.approval = 'four_eyes' AND NEW.approval = 'single') THEN
    RAISE EXCEPTION 'a single approval stays on the record' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.second_review IS NOT DISTINCT FROM OLD.second_review THEN
    RETURN NEW;
  END IF;
  IF OLD.second_review IS NULL AND NEW.second_review = 'due' THEN
    RETURN NEW;
  END IF;
  IF OLD.second_review IS DISTINCT FROM 'due' THEN
    RAISE EXCEPTION 'a second review moves only from due' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.second_review = 'void' THEN
    IF NEW.status IS DISTINCT FROM 'rejected' THEN
      RAISE EXCEPTION 'a second review is void only on a rejected change request' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM knowledge_revisions WHERE change_request_id = NEW.id AND created_by = NEW.second_review_by) THEN
    RAISE EXCEPTION 'a second reviewer may not have written a revision in the change request' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.second_review = 'disputed' AND NOT EXISTS (
    SELECT 1 FROM knowledge_second_reviews WHERE change_request_id = NEW.id AND decision = 'disputed') THEN
    RAISE EXCEPTION 'a second review is disputed only by a dispute in a role' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.second_review = 'confirmed' AND cardinality(knowledge_second_review_owed(NEW.id)) > 0 THEN
    RAISE EXCEPTION 'a second review is confirmed only once every role approved alone is' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.second_review = 'confirmed' AND knowledge_sources_unchecked(NEW.id) THEN
    RAISE EXCEPTION 'a revision cites an operator-supplied capture whose source no reviewer checked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_change_requests_second_review BEFORE UPDATE ON "knowledge_change_requests"
  FOR EACH ROW EXECUTE FUNCTION knowledge_second_review_moves();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION knowledge_second_review_given() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM knowledge_change_requests WHERE id = NEW.change_request_id
                 AND second_review = 'due' AND status IN ('approved', 'published', 'rolled_back')) THEN
    RAISE EXCEPTION 'a second review is given only while it is due on an approved change request' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM knowledge_approvals WHERE change_request_id = NEW.change_request_id
                 AND role = NEW.role AND override_reason IS NOT NULL) THEN
    RAISE EXCEPTION 'a second review is owed only in a role approved alone' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM knowledge_revisions WHERE change_request_id = NEW.change_request_id AND created_by = NEW.reviewer) THEN
    RAISE EXCEPTION 'a second reviewer may not have written a revision in the change request' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_second_reviews_given BEFORE INSERT ON "knowledge_second_reviews"
  FOR EACH ROW EXECUTE FUNCTION knowledge_second_review_given();
--> statement-breakpoint
-- A dispute in any role disputes the request; the last owed confirmation confirms it.
CREATE OR REPLACE FUNCTION knowledge_second_review_closes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.decision = 'disputed' THEN
    UPDATE knowledge_change_requests SET second_review = 'disputed', second_review_by = NEW.reviewer, second_review_at = NEW.decided_at
    WHERE id = NEW.change_request_id;
  ELSIF cardinality(knowledge_second_review_owed(NEW.change_request_id)) = 0 THEN
    UPDATE knowledge_change_requests SET second_review = 'confirmed', second_review_by = NEW.reviewer, second_review_at = NEW.decided_at
    WHERE id = NEW.change_request_id;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_second_reviews_close AFTER INSERT ON "knowledge_second_reviews"
  FOR EACH ROW EXECUTE FUNCTION knowledge_second_review_closes();
--> statement-breakpoint
-- A disputed request publishes nothing more; its preview may be retracted so it can be rejected.
CREATE OR REPLACE FUNCTION knowledge_release_move_allowed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_status text; request_review text;
BEGIN
  SELECT status, second_review INTO request_status, request_review FROM knowledge_change_requests WHERE id = NEW.change_request_id;
  IF NEW.action = 'publish' THEN
    IF request_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'only an approved change request is published' USING ERRCODE = 'check_violation';
    END IF;
    IF request_review = 'disputed' THEN
      RAISE EXCEPTION 'a change request whose second review disputed it is not published' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM knowledge_revisions
                   WHERE revision_id = NEW.to_revision_id AND change_request_id = NEW.change_request_id) THEN
      RAISE EXCEPTION 'a publish releases a revision of its own change request' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF request_status = 'approved' AND request_review = 'disputed' AND NEW.channel = 'preview' THEN
    RETURN NEW;
  ELSIF request_status IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'only a published change request is rolled back' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- The second reviews are platform-private, as every change-request table.
SELECT secure_table('knowledge_second_reviews', 'false');
