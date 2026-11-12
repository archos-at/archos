-- A memory note belongs to a topic (ADR-0180): "Brandschutz", "Stellplätze",
-- "Bauherr". The screens show a shelf as folders by topic, a person moves a
-- note, renames or merges a topic, and the agent files each note into one.
--
-- A topic is a text column on the note, not a table of its own: no foreign key,
-- no policy of its own. The note's row-level security (0229 for personal
-- memory, 0031 for project memory) covers its topic. NULL is "no
-- topic". The topics of a shelf are the distinct values of the notes a reader
-- can see on it, computed in the BFF (`bff/memory-topics/topic.ts`), so the
-- database never counts notes a reader may not see.
--
-- The CHECK holds what `normalizeTopic` writes: trimmed, 1 to 40 characters,
-- with the inner whitespace already collapsed to one space. Dropped and added
-- again, so the statement applies twice. Additive only: nothing is dropped,
-- renamed or made NOT NULL.
ALTER TABLE "personal_memory" ADD COLUMN IF NOT EXISTS "topic" text;
--> statement-breakpoint
ALTER TABLE "project_memory" ADD COLUMN IF NOT EXISTS "topic" text;
--> statement-breakpoint
ALTER TABLE "personal_memory" DROP CONSTRAINT IF EXISTS "personal_memory_topic_bounded";
--> statement-breakpoint
ALTER TABLE "personal_memory" ADD CONSTRAINT "personal_memory_topic_bounded"
  CHECK ("topic" IS NULL OR (char_length("topic") BETWEEN 1 AND 40 AND "topic" = btrim("topic")));
--> statement-breakpoint
ALTER TABLE "project_memory" DROP CONSTRAINT IF EXISTS "project_memory_topic_bounded";
--> statement-breakpoint
ALTER TABLE "project_memory" ADD CONSTRAINT "project_memory_topic_bounded"
  CHECK ("topic" IS NULL OR (char_length("topic") BETWEEN 1 AND 40 AND "topic" = btrim("topic")));
--> statement-breakpoint
-- The topic index: a shelf's topic list and a topic's notes, per owner or project.
CREATE INDEX IF NOT EXISTS "idx_personal_memory_topic"
  ON "personal_memory" ("organization_id", "user_id", "topic");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_memory_topic"
  ON "project_memory" ("organization_id", "project_id", "topic");
