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
-- - `second_review` moves only `due` → `confirmed` or `disputed`, by somebody
--   who wrote nothing in the request, and never back.
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
  CHECK ("second_review" IN ('due', 'confirmed', 'disputed'));
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
  IF OLD.second_review IS DISTINCT FROM 'due' OR NEW.second_review NOT IN ('confirmed', 'disputed') THEN
    RAISE EXCEPTION 'a second review moves only from due to confirmed or disputed' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM knowledge_revisions WHERE change_request_id = NEW.id AND created_by = NEW.second_review_by) THEN
    RAISE EXCEPTION 'a second reviewer may not have written a revision in the change request' USING ERRCODE = 'check_violation';
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
