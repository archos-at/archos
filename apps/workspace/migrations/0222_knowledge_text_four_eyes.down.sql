-- Reverse 0222. ORDER: roll the frontend back first; the newer build writes
-- `source_origin` on every fetched capture and tells a reviewer that an
-- uploaded text, or anything fetched through an unreviewed source, needs
-- another person's source check.
--
-- LOSSY: `source_origin` and `source_revision_id` of the captures fetched
-- since are dropped, so applying 0222 again holds those captures like the
-- ones stored before it (fetched only if their source is a built-in one).
-- 0218's source check comes back: only an operator-supplied capture holds an
-- approval up.
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
CREATE OR REPLACE FUNCTION knowledge_approval_sources_checked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF knowledge_sources_unchecked(NEW.change_request_id) THEN
    RAISE EXCEPTION 'a revision cites an operator-supplied capture whose source no reviewer checked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP FUNCTION IF EXISTS knowledge_text_counts_as_fetched(jsonb, text, text, timestamp with time zone);
DROP FUNCTION IF EXISTS knowledge_capture_counts_as_fetched(text, text, text, uuid, timestamp with time zone);
DROP FUNCTION IF EXISTS knowledge_source_reviewed(text, text, text, timestamp with time zone);
ALTER TABLE "knowledge_citation_captures" DROP CONSTRAINT IF EXISTS knowledge_citation_captures_fetched_names_origin;
ALTER TABLE "knowledge_citation_captures" DROP CONSTRAINT IF EXISTS knowledge_citation_captures_source_revision_named;
ALTER TABLE "knowledge_citation_captures" DROP CONSTRAINT IF EXISTS knowledge_citation_captures_source_origin_known;
ALTER TABLE "knowledge_citation_captures" DROP COLUMN IF EXISTS "source_revision_id";
ALTER TABLE "knowledge_citation_captures" DROP COLUMN IF EXISTS "source_origin";
