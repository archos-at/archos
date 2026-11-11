-- One operator alone, on a deployment that says so (the owner's decision of
-- 2026-11-11; extends 0208, 0214 and 0224).
--
-- On dev, four eyes on platform change requests only slows the team down. A
-- deployment with `KNOWLEDGE_SINGLE_OPERATOR=true` (the dev stack alone) has
-- the BFF set the transaction-local `knowledge.single_operator` to `on` in
-- every change request transaction (`platformTransaction`,
-- `bff/base-knowledge/platform/single-operator.ts`). While it is on:
--
-- - an author's verdicts on their own request are recorded (0208 refused them);
-- - the author's own `source_checked` verdict counts as the source check, also
--   for a text they attached (0224 asked for somebody else);
-- - an override approval marks the request `single` and leaves no second
--   review due (0214 marked one due). 0214's CHECK that a single approval
--   always owes one moves into `knowledge_second_review_moves`, which reads
--   the setting; the CHECK keeps its other half, that only a single approval
--   owes one. A CHECK may not read a setting: a restore would re-check dev's
--   rows without it.
--
-- The override still needs `platform:knowledge:approve_alone`, a reason and the
-- person's own yes, and is audited as `change_request_approved_alone`. A plain
-- approve by an author is still refused: approving alone stays visible.
--
-- Unset, which is prod and every deployment that does not say otherwise, each
-- function below answers exactly what it answered before: the new condition is
-- false and drops out. The setting is no lock: anything running SQL as the
-- runtime role could set it, as it could on any GUC. The triggers catch an
-- application path that skips the service, and no such path sets it.
CREATE OR REPLACE FUNCTION knowledge_single_operator() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('knowledge.single_operator', true), '') = 'on'
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION knowledge_review_in_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM knowledge_revisions
                 WHERE revision_id = NEW.revision_id AND change_request_id = NEW.change_request_id) THEN
    RAISE EXCEPTION 'a review decision names a revision of its own change request' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT knowledge_single_operator()
     AND EXISTS (SELECT 1 FROM knowledge_revisions WHERE change_request_id = NEW.change_request_id AND created_by = NEW.reviewer) THEN
    RAISE EXCEPTION 'a reviewer may not review a change request holding a revision they wrote' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION knowledge_sources_unchecked(request uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  WITH released AS (
    SELECT DISTINCT ON (record_id) revision_id, created_by, created_at, provenance FROM knowledge_revisions
    WHERE change_request_id = request ORDER BY record_id, created_at DESC, revision_id DESC
  )
  SELECT EXISTS (
    SELECT 1
    FROM released r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.provenance -> 'citations') = 'array' THEN r.provenance -> 'citations' ELSE '[]'::jsonb END
    ) AS c(citation)
    JOIN knowledge_citation_captures k ON k.id::text = c.citation ->> 'captureId'
    WHERE NOT knowledge_capture_counts_as_fetched(k.basis, k.source_id, k.source_origin, k.source_revision_id, k.created_at)
      AND NOT EXISTS (
        SELECT 1 FROM knowledge_review_decisions d
        WHERE d.revision_id = r.revision_id AND d.source_checked
          AND (d.reviewer <> r.created_by OR knowledge_single_operator())
      )
  ) OR EXISTS (
    SELECT 1
    FROM released r
    JOIN knowledge_manifestation_revisions m ON m.revision_id = r.revision_id
    WHERE m.corpus_file IS NOT NULL
      AND NOT knowledge_text_counts_as_fetched(r.provenance, m.corpus_file, m.sha256, r.created_at)
      AND NOT EXISTS (
        SELECT 1 FROM knowledge_review_decisions d
        WHERE d.revision_id = r.revision_id AND d.source_checked
          AND (knowledge_single_operator()
               OR (d.reviewer <> r.created_by AND d.reviewer IS DISTINCT FROM (r.provenance #>> '{text,attachedBy}')))
      )
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION knowledge_approval_override_marks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF knowledge_single_operator() THEN
    UPDATE knowledge_change_requests SET approval = 'single'
    WHERE id = NEW.change_request_id AND second_review IS NULL;
    RETURN NEW;
  END IF;
  UPDATE knowledge_change_requests SET approval = 'single', second_review = 'due'
  WHERE id = NEW.change_request_id AND second_review IS NULL;
  RETURN NEW;
END
$$;
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" DROP CONSTRAINT IF EXISTS knowledge_change_requests_single_owes_review;
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" DROP CONSTRAINT IF EXISTS knowledge_change_requests_only_single_owes_review;
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" ADD CONSTRAINT knowledge_change_requests_only_single_owes_review
  CHECK ("second_review" IS NULL OR "approval" = 'single');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION knowledge_second_review_moves() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.approval IS DISTINCT FROM OLD.approval AND NOT (OLD.approval = 'four_eyes' AND NEW.approval = 'single') THEN
    RAISE EXCEPTION 'a single approval stays on the record' USING ERRCODE = 'check_violation';
  END IF;
  -- What 0214's CHECK held, now here: a single approval owes a second review, unless one operator approved alone.
  -- Only the approval's move reads the setting; a review once owed is never dropped.
  IF NEW.approval = 'single' AND NEW.second_review IS NULL
     AND (OLD.second_review IS NOT NULL OR (OLD.approval IS DISTINCT FROM 'single' AND NOT knowledge_single_operator())) THEN
    RAISE EXCEPTION 'a single approval owes a second review' USING ERRCODE = 'check_violation';
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
-- A request starts as a draft (0218), so as a four-eyes one: none is written single without its review.
CREATE OR REPLACE FUNCTION knowledge_change_request_starts_four_eyes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a single approval owes a second review' USING ERRCODE = 'check_violation';
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS knowledge_change_requests_starts_four_eyes ON "knowledge_change_requests";
--> statement-breakpoint
CREATE TRIGGER knowledge_change_requests_starts_four_eyes BEFORE INSERT ON "knowledge_change_requests"
  FOR EACH ROW WHEN (NEW.approval = 'single' AND NEW.second_review IS NULL)
  EXECUTE FUNCTION knowledge_change_request_starts_four_eyes();
