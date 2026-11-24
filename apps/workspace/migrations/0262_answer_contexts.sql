-- 0262: answer_contexts, the server-written record of what one answer was
-- allowed to read and what it read (ADR-0194, "The record per answer").
--
-- One row per answer, keyed by (organization, answer message id), the id the
-- agent mints for the turn's answer before it reads anything. The BFF writes
-- it when it decides the turn (`POST /api/internal/turn-decision`) and adds to
-- `read_*` as the agent reports what a tool actually read (`admit`). The
-- browser never writes it: the client's `retrievalLedger` stays a display aid.
--
--   kind              chat, run, headless or external
--   audience_version  the conversation's `audience_version` the turn was
--                     decided under; NULL when the row did not exist yet
--   solo              whether the asker alone read the conversation then
--   shelves           the collections the turn was allowed to search
--   other_projects    how far outside its own project it could reach: none,
--                     every-reader (what every reader may open) or
--                     chat-projects (what the asker may chat in)
--   workspace_read    none, document+projectFacts or all
--   personal_memory, personal_shelf
--                     whether either was allowed in the turn
--   read_folders, read_projects, read_personal_shelf
--                     what the turn actually drew on, as reported
--
-- No foreign key, for 0112's reason: a chat's first turn runs before its row
-- exists. Erasing the conversation deletes its rows (`deleteConversationInOrg`).
CREATE TABLE IF NOT EXISTS "answer_contexts" (
  "organization_id" text NOT NULL,
  "message_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "user_id" text NOT NULL,
  "kind" text NOT NULL,
  "audience_version" integer,
  "solo" boolean NOT NULL,
  "project_id" uuid,
  "shelves" text[] DEFAULT '{}'::text[] NOT NULL,
  "other_projects" text NOT NULL,
  "workspace_read" text NOT NULL,
  "personal_memory" boolean NOT NULL,
  "personal_shelf" boolean NOT NULL,
  "read_folders" text[] DEFAULT '{}'::text[] NOT NULL,
  "read_projects" text[] DEFAULT '{}'::text[] NOT NULL,
  "read_personal_shelf" boolean DEFAULT false NOT NULL,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "answer_contexts_pk" PRIMARY KEY ("organization_id", "message_id"),
  CONSTRAINT "answer_contexts_kind" CHECK ("kind" IN ('chat', 'run', 'headless', 'external')),
  CONSTRAINT "answer_contexts_other_projects" CHECK ("other_projects" IN ('none', 'every-reader', 'chat-projects')),
  CONSTRAINT "answer_contexts_workspace_read" CHECK ("workspace_read" IN ('none', 'document+projectFacts', 'all')),
  CONSTRAINT "answer_contexts_version" CHECK ("audience_version" IS NULL OR "audience_version" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "answer_contexts_conversation_idx"
  ON "answer_contexts" ("organization_id", "conversation_id");
--> statement-breakpoint
COMMENT ON TABLE "answer_contexts" IS
  'What one answer was allowed to read and what it read, written by the BFF (ADR-0194). Never written by the browser.';
--> statement-breakpoint
SELECT secure_table('answer_contexts', 'organization_id = current_org()');
