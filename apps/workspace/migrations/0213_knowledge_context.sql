-- 0213: what a turn needs to learn which country, edition and coverage apply (ADR-0173).
--
-- ## What was missing
--
-- 0205 and 0211 hold the platform's records and which edition binds where, but
-- nothing said how far a country's records go. An office entitled to Germany
-- with nothing reviewed there would read an uncurated statute exactly like a
-- curated Austrian one. Design §4.6 and §5.5; build split S15.
--
-- ## The shape
--
-- - **Coverage** is a claim on a territory's revision (`coverage_level`,
--   `municipal_law`), so it is proposed, reviewed and released like every other
--   platform claim, and only a publish changes it (design §4.6). NULL is no
--   record: a node without one inherits from its parent, and a chain with none
--   at all reads `none` (fail closed).
-- - **Connecting factor** of a work (`connects_by`): `site` for law that binds
--   where the project stands, `office_seat` or `client` for law that attaches
--   to the office's seat or to who commissions it (HOAI, VgV). Such a work never
--   binds by the site's chain alone; the turn reads it as `information` (E40).
-- - **`message_edition_uses`**: which edition, in which role and at which pack
--   sequences, an answer used, written by the BFF when it persists the answer
--   (design §5.5 "Server-side record", E25). A hotfix notice and a replay read
--   this, never the provenance a client sent. Keyed by its organization;
--   append-only, and gone only with its message.
-- - **`project_base_confirmations`**: the Steckbrief a person confirmed, a
--   snapshot of its uses and the pack sequences it was resolved at (design §5.4,
--   `project-base-confirm`). Keyed by its organization; append-only, and
--   gone only with its project.

ALTER TABLE "knowledge_territory_revisions" ADD COLUMN IF NOT EXISTS "coverage_level" text;
--> statement-breakpoint
ALTER TABLE "knowledge_territory_revisions" ADD COLUMN IF NOT EXISTS "municipal_law" boolean;
--> statement-breakpoint
ALTER TABLE "knowledge_territory_revisions" ADD CONSTRAINT knowledge_territory_revisions_coverage_known
  CHECK ("coverage_level" IS NULL OR "coverage_level" IN ('none', 'open', 'core', 'full'));
--> statement-breakpoint
ALTER TABLE "knowledge_work_revisions" ADD COLUMN IF NOT EXISTS "connects_by" text[] DEFAULT '{site}'::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_work_revisions" ADD CONSTRAINT knowledge_work_revisions_connects_by_known
  CHECK (cardinality("connects_by") BETWEEN 1 AND 3 AND "connects_by" <@ ARRAY['site', 'office_seat', 'client']::text[]);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_edition_uses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Goes with its message, and only with it.
  "message_id" uuid NOT NULL REFERENCES "messages" ("id") ON DELETE CASCADE,
  "organization_id" text DEFAULT nullif(current_setting('grid.organization_id', true), '') NOT NULL,
  "project_id" uuid,
  "work_id" text NOT NULL,
  -- NULL for law read live at its source (the consolidated text in force today).
  "edition_id" text,
  "role" text NOT NULL,
  "qualifier" text,
  -- `{ "AT": 41, "EU": 7 }`: the stable release sequence of each pack the answer was resolved at.
  "pack_seqs" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT message_edition_uses_role_known CHECK (
    "role" IN ('binding', 'guidance', 'interpretation', 'authority_practice', 'information')),
  CONSTRAINT message_edition_uses_qualifier_known CHECK (
    "qualifier" IS NULL OR "qualifier" IN ('uncurated', 'office_maintained')),
  CONSTRAINT message_edition_uses_pack_seqs_object CHECK (jsonb_typeof("pack_seqs") = 'object'),
  -- NULLS NOT DISTINCT: a live law (no edition) is recorded once per answer too.
  CONSTRAINT message_edition_uses_one_per_edition UNIQUE NULLS NOT DISTINCT ("message_id", "work_id", "edition_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_edition_uses_edition_idx" ON "message_edition_uses" ("edition_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_edition_uses_message_idx" ON "message_edition_uses" ("organization_id", "message_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_base_confirmations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text DEFAULT nullif(current_setting('grid.organization_id', true), '') NOT NULL,
  -- Goes with its project, and only with it.
  "project_id" uuid NOT NULL REFERENCES "projects" ("id") ON DELETE CASCADE,
  "confirmed_by" text NOT NULL,
  "decision_source" text NOT NULL,
  -- The Steckbrief as the person saw it: gate, chain, uses with their roles and editions. Ids and tokens, never norm text.
  "snapshot" jsonb NOT NULL,
  "pack_seqs" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT project_base_confirmations_source_known CHECK ("decision_source" IN ('app', 'elicitation')),
  CONSTRAINT project_base_confirmations_snapshot_object CHECK (jsonb_typeof("snapshot") = 'object'),
  CONSTRAINT project_base_confirmations_snapshot_bounded CHECK (octet_length("snapshot"::text) <= 65536)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_base_confirmations_project_idx"
  ON "project_base_confirmations" ("organization_id", "project_id", "confirmed_at" DESC);
--> statement-breakpoint
CREATE TRIGGER message_edition_uses_append_only BEFORE UPDATE OR DELETE ON "message_edition_uses"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
CREATE TRIGGER project_base_confirmations_append_only BEFORE UPDATE OR DELETE ON "project_base_confirmations"
  FOR EACH ROW EXECUTE FUNCTION knowledge_append_only();
--> statement-breakpoint
SELECT secure_table('message_edition_uses', 'organization_id = current_org()');
--> statement-breakpoint
SELECT secure_table('project_base_confirmations', 'organization_id = current_org()');
