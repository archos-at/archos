-- Four eyes on what nobody fetched from a reviewed source (ADR-0165, "Texts are
-- attached in the request"; extends 0218).
--
-- A manifestation's text is what an office later reads as the law, and a
-- capture is what a reviewer reads a record's quotes against. One the product
-- fetched through a source two people have seen comes from the publisher. One
-- a person uploaded or pasted, one a record only names in the corpus, and one
-- fetched through a source its own author configured, come from that person:
-- they could upload their own PDF as "OIB-RL 6 2015", or propose a source
-- whose host is theirs and "fetch" it from there, approve alone and publish.
-- So anything else is held like an operator-supplied capture: no approval,
-- alone or not, until somebody other than its author (and, for a text, its
-- uploader) marked a verdict on that revision `source_checked`.
--
-- ## What counts as fetched
--
-- The fetch records which source it went through, at fetch time
-- (`knowledge_citation_captures.source_origin` and `.source_revision_id`; for
-- a text, `sourceOrigin` and `sourceRevisionId` on `provenance.text`):
--
-- - `built_in`: a source the repository configures (`configs/sources`,
--   reviewed as code): at-ris, ch-fedlex.
-- - `released`: a source record's released revision. Counted only when that
--   revision was published to stable before the fetch, by a request that two
--   people saw: approved by four eyes, or approved alone and since confirmed
--   by its second review. A source one person released alone opens nothing
--   until then.
-- - `draft`: a source proposed in the same change request, usable to test a
--   fetch for 24 hours (ADR-0174). Never counted.
--
-- A capture stored before these columns has none, and neither has one an older
-- build writes during a rollout or after a rollback: no CHECK asks a fetch for
-- its origin, so that build keeps working. Such a capture counts as fetched
-- only when no platform record ever configured its source, which leaves a
-- built-in one; a fetch through a source record without an origin is held.
--
-- A fetched text counts only while the revision still names the fetched file
-- and its bytes (`corpus_file` and `sha256` are the provenance's). The kit and
-- the indexing job hold the corpus to that hash, so the reviewed bytes are the
-- published ones.
--
-- Expand only: two nullable columns that an older build may leave empty, three functions, and
-- `knowledge_sources_unchecked` keeps its name and signature; every request it
-- held before it still holds.
ALTER TABLE "knowledge_citation_captures" ADD COLUMN IF NOT EXISTS "source_origin" text;
--> statement-breakpoint
ALTER TABLE "knowledge_citation_captures" ADD COLUMN IF NOT EXISTS "source_revision_id" uuid;
--> statement-breakpoint
ALTER TABLE "knowledge_citation_captures" DROP CONSTRAINT IF EXISTS knowledge_citation_captures_source_origin_known;
--> statement-breakpoint
ALTER TABLE "knowledge_citation_captures" ADD CONSTRAINT knowledge_citation_captures_source_origin_known
  CHECK ("source_origin" IS NULL OR ("source_origin" IN ('built_in', 'released', 'draft') AND "basis" = 'fetched'));
--> statement-breakpoint
-- A source record's revision is named exactly when a source record was used.
ALTER TABLE "knowledge_citation_captures" DROP CONSTRAINT IF EXISTS knowledge_citation_captures_source_revision_named;
--> statement-breakpoint
ALTER TABLE "knowledge_citation_captures" ADD CONSTRAINT knowledge_citation_captures_source_revision_named
  CHECK (("source_revision_id" IS NOT NULL) = coalesce("source_origin" IN ('released', 'draft'), false));
--> statement-breakpoint
-- Whether a fetch went through a source two people have seen: a built-in one, or a source record's revision
-- released before the fetch by a request approved by four eyes or confirmed by its second review.
CREATE OR REPLACE FUNCTION knowledge_source_reviewed(source text, origin text, revision text, fetched_at timestamp with time zone)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE origin
    WHEN 'built_in' THEN source IS NOT NULL
    WHEN 'released' THEN EXISTS (
      SELECT 1
      FROM knowledge_release_moves mv
      JOIN knowledge_change_requests cr ON cr.id = mv.change_request_id
      WHERE mv.record_id = 'source:' || source AND mv.to_revision_id::text = revision
        AND mv.channel = 'stable' AND mv.action = 'publish' AND mv.released_at <= fetched_at
        AND (cr.second_review IS NULL OR cr.second_review = 'confirmed')
    )
    ELSE false
  END
$$;
--> statement-breakpoint
-- A capture the product fetched through a reviewed source. One stored before `source_origin` counts only when no
-- platform record ever configured its source.
CREATE OR REPLACE FUNCTION knowledge_capture_counts_as_fetched(
  basis text, source text, origin text, revision uuid, captured_at timestamp with time zone
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT basis = 'fetched' AND source IS NOT NULL AND CASE
    WHEN origin IS NULL THEN NOT EXISTS (SELECT 1 FROM knowledge_revisions s WHERE s.record_id = 'source:' || source)
    ELSE knowledge_source_reviewed(source, origin, revision::text, captured_at)
  END
$$;
--> statement-breakpoint
-- A manifestation's text the product fetched through a reviewed source, while the revision still names the fetched
-- file and bytes. `proposed_at` is the revision's `created_at`: the fetch ended before it.
CREATE OR REPLACE FUNCTION knowledge_text_counts_as_fetched(
  provenance jsonb, corpus_file text, sha256 text, proposed_at timestamp with time zone
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    provenance #>> '{text,origin}' = 'url'
    AND provenance #>> '{text,fileName}' = corpus_file
    AND provenance #>> '{text,sha256}' = sha256
    AND knowledge_source_reviewed(
      provenance #>> '{text,sourceId}', provenance #>> '{text,sourceOrigin}', provenance #>> '{text,sourceRevisionId}', proposed_at),
    false)
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
-- The refusal names both cases; the service reads "no reviewer checked" in it.
CREATE OR REPLACE FUNCTION knowledge_approval_sources_checked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF knowledge_sources_unchecked(NEW.change_request_id) THEN
    RAISE EXCEPTION 'a revision cites a capture, or names a text, that nobody fetched from a reviewed source and whose source no reviewer checked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
