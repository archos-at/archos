-- 0228: a country's golden cases as platform records, and the golden runs that
-- score them (ADR-0165 amendment "golden cases and the golden run", design
-- §4.4 and §4.6, country-as-data review 3.3).
--
-- ## What was missing
--
-- A country could be onboarded as records, but nothing said what a right
-- answer in that country is. The quality bar was a scorecard of seconds, the
-- model's own confidence and a source count, with no expected value, kept in
-- the repository for Austria alone. A second country could not bring a bar of
-- its own, and "better than before" was an opinion.
--
-- ## The shape
--
-- - A platform record type `golden_case`: one question with the context it
--   needs (the site's territory, stated project facts, a reference day), what a
--   right answer says (expected values, the edition and its role, the
--   citations), what it must not do (`must_not`), and tags. Proposed, reviewed
--   and published in a change request like every other record; the body keeps
--   the structured parts as jsonb, validated by the wire (`wire/golden-case.ts`).
-- - `knowledge_golden_runs`: one run of a country's cases, released or of one
--   change request, with the stable release sequence it was answered on.
-- - `knowledge_golden_run_cases`: one case of a run. It names the ask that
--   answered it (the turn ran in a conversation of the operator's own
--   organization), and once settled holds the verdict and the scores.
--
-- ## RLS
--
-- All of it is platform-private. A case's body is a platform row
-- (`organization_id` NULL by CHECK), which no tenant's `current_org()` meets;
-- the run tables are `false` for the runtime role, as the change-request tables
-- are. A run names the organization it asked in as `asked_in`, never as
-- `organization_id`: no tenant reads a run, the platform organization included.
--
-- The case's record and revision rows are the exception that needed work:
-- `knowledge_records` and `knowledge_revisions` carry 0205/0211's layered read,
-- under which a released platform row is readable by any office entitled to the
-- country, so an office would have read `golden_case:<key>`, its provenance
-- notes and `created_by`. Both policies are restated below with
-- `type <> 'golden_case'` in the platform branch. The platform's own access is
-- the BYPASSRLS platform role (`withPlatformAccess`), which the policy does not
-- touch.
--
-- Expand-only: two CHECKs widened by one word, three tables added, two read
-- policies narrowed to the types an office was never meant to see.

ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_type_known;
--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_type_known
  CHECK ("type" IN ('work', 'edition', 'manifestation', 'ruleset', 'territory', 'authority', 'relation', 'source', 'golden_case'));
--> statement-breakpoint
ALTER TABLE "knowledge_records" DROP CONSTRAINT IF EXISTS knowledge_records_platform_types;
--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD CONSTRAINT knowledge_records_platform_types
  CHECK ("type" NOT IN ('territory', 'authority', 'source', 'golden_case') OR "organization_id" IS NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_golden_case_revisions" (
  "revision_id" uuid PRIMARY KEY NOT NULL,
  "record_id" text NOT NULL,
  "organization_id" text,
  "owner_key" text GENERATED ALWAYS AS (coalesce("organization_id", '')) STORED NOT NULL,
  "question" text NOT NULL,
  -- BCP 47: the language the question is asked and the expected phrases are written in.
  "language" text NOT NULL,
  "context" jsonb NOT NULL,
  "expected" jsonb NOT NULL,
  "must_not" jsonb NOT NULL,
  "tags" text[] NOT NULL,
  CONSTRAINT knowledge_golden_case_revisions_platform CHECK ("organization_id" IS NULL),
  CONSTRAINT knowledge_golden_case_revisions_question_bounded CHECK (char_length("question") BETWEEN 1 AND 1000),
  CONSTRAINT knowledge_golden_case_revisions_language_format CHECK ("language" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  CONSTRAINT knowledge_golden_case_revisions_context_object CHECK (jsonb_typeof("context") = 'object'),
  CONSTRAINT knowledge_golden_case_revisions_expected_object CHECK (jsonb_typeof("expected") = 'object'),
  CONSTRAINT knowledge_golden_case_revisions_must_not_array CHECK (jsonb_typeof("must_not") = 'array'),
  CONSTRAINT knowledge_golden_case_revisions_tags_bounded CHECK (cardinality("tags") <= 20),
  CONSTRAINT knowledge_golden_case_revisions_revision_fk FOREIGN KEY ("revision_id", "owner_key")
    REFERENCES "knowledge_revisions" ("revision_id", "owner_key") ON DELETE CASCADE,
  CONSTRAINT knowledge_golden_case_revisions_record_fk FOREIGN KEY ("revision_id", "record_id")
    REFERENCES "knowledge_revisions" ("revision_id", "record_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_golden_case_revisions_record_idx" ON "knowledge_golden_case_revisions" ("record_id");
--> statement-breakpoint
CREATE TRIGGER knowledge_golden_case_revisions_append_only BEFORE UPDATE OR DELETE ON "knowledge_golden_case_revisions"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_golden_runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "country_id" text NOT NULL,
  -- The change request whose cases ran; NULL for the released cases.
  "change_request_id" uuid REFERENCES "knowledge_change_requests" ("id"),
  -- The organization the questions were asked in: the operator's own. Not `organization_id`: no tenant reads a run.
  "asked_in" text NOT NULL,
  "started_by" text NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  -- The country's newest stable release when the run started: what the answers were given on.
  "release_seq" bigint,
  CONSTRAINT knowledge_golden_runs_country_format CHECK ("country_id" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_golden_runs_country_idx" ON "knowledge_golden_runs" ("country_id", "started_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_golden_run_cases" (
  "run_id" uuid NOT NULL REFERENCES "knowledge_golden_runs" ("id") ON DELETE CASCADE,
  "record_id" text NOT NULL,
  "revision_id" uuid NOT NULL,
  "position" integer NOT NULL,
  -- The ask that answers it and its conversation; NULL until the case is asked.
  "ask_id" uuid,
  "conversation_id" text,
  "asked_at" timestamp with time zone,
  "settled_at" timestamp with time zone,
  -- Every check held; NULL while open, and for a case that could not be answered (`failure`).
  "passed" boolean,
  -- The checks, the scores, the seconds and the cost (`golden/wire.ts`, `GoldenCaseResult`).
  "result" jsonb,
  "failure" text,
  PRIMARY KEY ("run_id", "record_id"),
  CONSTRAINT knowledge_golden_run_cases_revision_fk FOREIGN KEY ("revision_id", "record_id")
    REFERENCES "knowledge_revisions" ("revision_id", "record_id"),
  CONSTRAINT knowledge_golden_run_cases_asked CHECK (("ask_id" IS NULL) = ("conversation_id" IS NULL) AND ("ask_id" IS NULL) = ("asked_at" IS NULL)),
  CONSTRAINT knowledge_golden_run_cases_settled CHECK (
    ("settled_at" IS NULL AND "passed" IS NULL AND "result" IS NULL AND "failure" IS NULL)
    OR ("settled_at" IS NOT NULL AND (("passed" IS NOT NULL AND "result" IS NOT NULL AND "failure" IS NULL) OR ("passed" IS NULL AND "result" IS NULL AND "failure" IS NOT NULL)))),
  CONSTRAINT knowledge_golden_run_cases_result_object CHECK ("result" IS NULL OR jsonb_typeof("result") = 'object'),
  CONSTRAINT knowledge_golden_run_cases_failure_bounded CHECK ("failure" IS NULL OR char_length("failure") <= 500)
);
--> statement-breakpoint
-- The turn context finds a golden turn by its conversation: one case per conversation.
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_golden_run_cases_conversation"
  ON "knowledge_golden_run_cases" ("conversation_id") WHERE "conversation_id" IS NOT NULL;
--> statement-breakpoint
-- A body is a platform row (organization_id is always NULL, by CHECK), so no tenant reads one.
SELECT secure_table('knowledge_golden_case_revisions', 'organization_id = current_org()');
--> statement-breakpoint
SELECT secure_table('knowledge_golden_runs', 'false');
--> statement-breakpoint
SELECT secure_table('knowledge_golden_run_cases', 'false');
--> statement-breakpoint
-- 0211's layered read of records, minus the platform-private type.
SELECT secure_table('knowledge_records',
  'organization_id = current_org() OR (organization_id IS NULL AND type <> ''golden_case'' AND head_revision_id IS NOT NULL '
  'AND (knowledge_country_entitled(country_id) OR knowledge_reached_by_relation(id)))');
--> statement-breakpoint
-- 0205's layered read of revisions, minus the same type (named here too: the record subquery alone would hide it only through the record policy above).
SELECT secure_table('knowledge_revisions',
  'organization_id = current_org() OR (organization_id IS NULL AND knowledge_revision_released(revision_id) '
  'AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.id = record_id AND r.type <> ''golden_case''))');
