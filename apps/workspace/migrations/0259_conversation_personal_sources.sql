-- 0259: conversation_personal_sources: what a chat drew on that is one
-- person's alone, their own shelf („Meine Ablage“) or their personal memory
-- (ADR-0191 rule 5).
--
-- A chat without a project, read by its owner alone, may draw on both. Its
-- answers then rest on material nobody else may read, and sharing the chat
-- would show those answers to the people it is shared with. This table is the
-- record that makes sharing ask the owner first; once shared, the chat is no
-- longer read by its owner alone and draws on neither any more
-- (`isSoloAudience`), so the record only grows while the chat is solo.
--
-- The record follows `conversation_source_projects` (0125) and
-- `conversation_restricted_folders` (0112): no foreign key, because the first
-- turn of a chat runs before its row exists. Written by
-- `recordPersonalSources` (`bff/conversations/personal-use.ts`) when a turn's
-- scope holds the owner's shelf with something on it, when the turn is given
-- personal notes, and when the agent opens one of the owner's own documents.
CREATE TABLE IF NOT EXISTS "conversation_personal_sources" (
  "organization_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "source" text NOT NULL,
  "first_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_personal_sources_pk" PRIMARY KEY ("organization_id", "conversation_id", "source"),
  CONSTRAINT "conversation_personal_sources_known" CHECK ("source" IN ('personal_shelf', 'personal_memory')),
  CONSTRAINT "conversation_personal_sources_order" CHECK ("last_at" >= "first_at")
);
--> statement-breakpoint
SELECT secure_table('conversation_personal_sources', 'organization_id = current_org()');
