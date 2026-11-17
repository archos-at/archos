-- Personal memory: what the agent keeps about ONE person, read by that person
-- and nobody else (ADR-0180).
--
-- Project memory (0008) is read by every member of the project and
-- organization memory by everyone in the office. A note about a person (how
-- they like to work, what they are responsible for) had no shelf of its own
-- and landed in front of the team. This is that shelf.
--
-- A table of its own rather than a third scope in `project_memory`: that
-- table's policy is the organization's, so a personal row there would be hidden
-- from colleagues only by each of its twelve readers remembering a filter.
-- Here the policy names the person, as `user_preferences` does (0031): a query
-- that runs for somebody else matches no row, whatever its WHERE says.
--
-- Small on purpose: no status, no embedding, no recall count. A turn is given
-- at most 20 notes, pinned first, then newest (`bff/personal-memory/service.ts`).
-- Removing a note deletes the row.
CREATE TABLE IF NOT EXISTS "personal_memory" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "user_id" text NOT NULL,
  "kind" text NOT NULL,
  "content" text NOT NULL,
  "provenance_type" text DEFAULT 'agent' NOT NULL,
  "source_conversation_id" text,
  "pinned" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT personal_memory_kind_known CHECK ("kind" IN ('preference', 'profile')),
  CONSTRAINT personal_memory_provenance_known CHECK ("provenance_type" IN ('agent', 'user', 'distillation')),
  CONSTRAINT personal_memory_content_bounded CHECK (char_length(btrim("content")) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_personal_memory_owner"
  ON "personal_memory" ("organization_id", "user_id", "pinned" DESC, "updated_at" DESC);
--> statement-breakpoint
-- At most one note per person and normalized text: the agent restating what it
-- already holds refreshes that row (`createPersonalMemoryItem`). The expression
-- is `normalizeContent` (`bff/knowledge/consolidation.ts`) in SQL, as in 0010.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_personal_memory_owner_content"
  ON "personal_memory" (
    "organization_id",
    "user_id",
    (btrim(regexp_replace(lower("content"), '[^a-z0-9]+', ' ', 'g')))
  );
--> statement-breakpoint
SELECT secure_table('personal_memory', 'organization_id = current_org() AND user_id = current_user_id()');
