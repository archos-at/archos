-- Four eyes on a text nobody fetched (ADR-0165, "Texts are attached in the
-- request"; extends 0218).
--
-- A manifestation's text is what an office later reads as the law. One the
-- product fetched through a configured source (`provenance.text.origin = 'url'`)
-- comes from the publisher. One a person uploaded, or one a record only names
-- in the corpus, comes from that person: they could upload their own PDF as
-- "OIB-RL 6 2015", approve alone and publish. So such a text is held like an
-- operator-supplied capture: no approval, alone or not, until somebody other
-- than its author and its uploader marked a verdict on that revision
-- `source_checked`.
--
-- A fetched text counts as fetched only while the revision still names the
-- fetched file and its bytes (`corpus_file` and `sha256` are the provenance's).
-- The kit and the indexing job hold the corpus to that hash, so the reviewed
-- bytes are the published ones.
--
-- Expand only: the function keeps its name and signature, and every request it
-- held before it still holds.
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
  ) OR EXISTS (
    SELECT 1
    FROM released r
    JOIN knowledge_manifestation_revisions m ON m.revision_id = r.revision_id
    WHERE m.corpus_file IS NOT NULL
      AND (r.provenance #>> '{text,origin}' = 'url'
           AND r.provenance #>> '{text,fileName}' = m.corpus_file
           AND r.provenance #>> '{text,sha256}' = m.sha256) IS NOT TRUE
      AND NOT EXISTS (
        SELECT 1 FROM knowledge_review_decisions d
        WHERE d.revision_id = r.revision_id AND d.source_checked
          AND d.reviewer <> r.created_by
          AND d.reviewer IS DISTINCT FROM (r.provenance #>> '{text,attachedBy}')
      )
  )
$$;
--> statement-breakpoint
-- The refusal names both cases; the service reads "no reviewer checked" in it.
CREATE OR REPLACE FUNCTION knowledge_approval_sources_checked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF knowledge_sources_unchecked(NEW.change_request_id) THEN
    RAISE EXCEPTION 'a revision cites an operator-supplied capture, or names a text nobody fetched, whose source no reviewer checked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
