-- Reverse 0228. ORDER: roll the frontend back first, or unset
-- KNOWLEDGE_SINGLE_OPERATOR: this build sets `knowledge.single_operator`, and
-- the functions it restores no longer read it, so four eyes holds again on
-- every deployment.
--
-- LOSSY on dev: a request one operator approved alone there owes a second
-- review again (`due`), since 0214's CHECK says a single approval always does.
DROP TRIGGER IF EXISTS knowledge_change_requests_starts_four_eyes ON "knowledge_change_requests";
--> statement-breakpoint
DROP FUNCTION IF EXISTS knowledge_change_request_starts_four_eyes();
--> statement-breakpoint
UPDATE knowledge_change_requests SET second_review = 'due' WHERE approval = 'single' AND second_review IS NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" DROP CONSTRAINT IF EXISTS knowledge_change_requests_only_single_owes_review;
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" DROP CONSTRAINT IF EXISTS knowledge_change_requests_single_owes_review;
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" ADD CONSTRAINT knowledge_change_requests_single_owes_review
  CHECK (("approval" = 'single') = ("second_review" IS NOT NULL));
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
        WHERE d.revision_id = r.revision_id AND d.source_checked AND d.reviewer <> r.created_by
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
          AND d.reviewer <> r.created_by
          AND d.reviewer IS DISTINCT FROM (r.provenance #>> '{text,attachedBy}')
      )
  )
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
DROP FUNCTION IF EXISTS knowledge_single_operator();
