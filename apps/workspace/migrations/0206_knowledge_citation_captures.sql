-- Citation captures and the reviewer's source check (ADR-0170, design §4.3).
--
-- An agent onboarding a country through the platform door proposes records
-- that cite pages. A citation counts only when it names a capture of its
-- change request: the page as the product fetched it (`fetched`, through the
-- public-source fetcher), or a text an operator supplied because the page
-- could not be fetched (`operator_supplied`). KC-6 checks every quote span
-- against the capture's stored text, for every proposer, so an agent cannot
-- verify a page it made up.
--
-- - `knowledge_citation_captures`: insert-only, written only into a draft
--   change request; the bytes' sha256 and size, the text the quote check reads
--   (bounded), when and through which configured source it was retrieved, and
--   who captured it through which OAuth client.
-- - `knowledge_review_decisions.source_checked`: the reviewer checked the
--   cited capture against its source. A trigger refuses an approval of a
--   request with a revision that cites an operator-supplied capture until a
--   verdict on that revision says so: what nobody fetched, a person checked.
--
-- ## RLS
--
-- Platform-private like the other change-request tables (`secure_table(t,
-- 'false')`): the runtime role reads nothing; the platform routes run as the
-- BYPASSRLS platform role. A capture holds public pages only, never a tenant's
-- content. Listed in `rls-coverage.spec.ts`.

CREATE TABLE IF NOT EXISTS "knowledge_citation_captures" (
  "id" uuid PRIMARY KEY NOT NULL,
  "change_request_id" uuid NOT NULL REFERENCES "knowledge_change_requests" ("id"),
  "basis" text NOT NULL,
  -- The configured public source the fetch went through (`at-ris`); NULL for an operator's upload.
  "source_id" text,
  "url" text NOT NULL,
  -- Where the fetch ended after redirects, every hop on the source's hosts.
  "final_url" text,
  "content_type" text,
  "sha256" text NOT NULL,
  "byte_size" integer NOT NULL,
  -- What the quote check reads: the page's text; NULL when the bytes hold none (a binary file).
  "text" text,
  "note" text,
  "retrieved_at" timestamp with time zone NOT NULL,
  "created_by" text NOT NULL,
  "via_client" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT knowledge_citation_captures_basis_known CHECK ("basis" IN ('fetched', 'operator_supplied')),
  CONSTRAINT knowledge_citation_captures_fetched_has_source CHECK (("basis" = 'fetched') = ("source_id" IS NOT NULL)),
  CONSTRAINT knowledge_citation_captures_sha256_format CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT knowledge_citation_captures_size_bounded CHECK ("byte_size" BETWEEN 0 AND 20971520),
  CONSTRAINT knowledge_citation_captures_text_bounded CHECK ("text" IS NULL OR char_length("text") <= 2000000),
  CONSTRAINT knowledge_citation_captures_url_bounded CHECK (char_length("url") BETWEEN 1 AND 2000),
  CONSTRAINT knowledge_citation_captures_note_bounded CHECK ("note" IS NULL OR char_length("note") <= 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_citation_captures_request_idx"
  ON "knowledge_citation_captures" ("change_request_id", "created_at");
--> statement-breakpoint
CREATE TRIGGER knowledge_citation_captures_append_only BEFORE UPDATE OR DELETE ON "knowledge_citation_captures"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
-- A capture goes into a request still open for proposals (a draft).
CREATE OR REPLACE FUNCTION knowledge_capture_into_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM knowledge_change_requests WHERE id = NEW.change_request_id AND status = 'draft') THEN
    RAISE EXCEPTION 'citation captures go into a draft change request' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_citation_captures_into_draft BEFORE INSERT ON "knowledge_citation_captures"
  FOR EACH ROW EXECUTE FUNCTION knowledge_capture_into_draft();
--> statement-breakpoint
ALTER TABLE "knowledge_review_decisions" ADD COLUMN IF NOT EXISTS "source_checked" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- What nobody fetched, a person checked: no approval while a revision of the
-- request cites an operator-supplied capture and no verdict on that revision
-- says its source was checked.
CREATE OR REPLACE FUNCTION knowledge_approval_sources_checked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM knowledge_revisions r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.provenance -> 'citations') = 'array' THEN r.provenance -> 'citations' ELSE '[]'::jsonb END
    ) AS c(citation)
    JOIN knowledge_citation_captures k ON k.id::text = c.citation ->> 'captureId'
    WHERE r.change_request_id = NEW.change_request_id
      AND k.basis = 'operator_supplied'
      AND NOT EXISTS (
        SELECT 1 FROM knowledge_review_decisions d WHERE d.revision_id = r.revision_id AND d.source_checked
      )
  ) THEN
    RAISE EXCEPTION 'a revision cites an operator-supplied capture whose source no reviewer checked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_approvals_sources_checked BEFORE INSERT ON "knowledge_approvals"
  FOR EACH ROW EXECUTE FUNCTION knowledge_approval_sources_checked();
--> statement-breakpoint
SELECT secure_table('knowledge_citation_captures', 'false');
