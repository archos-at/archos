-- Reverse 0238. ORDER: roll the frontend and the agent back first; the newer
-- builds write `topic` on every note they keep and read it for every shelf.
--
-- LOSSY: every note's topic goes. The notes stay, unfiled, and a topic a person
-- made is forgotten. Nothing else referenced a topic.
DROP INDEX IF EXISTS "idx_project_memory_topic";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_personal_memory_topic";
--> statement-breakpoint
ALTER TABLE "project_memory" DROP CONSTRAINT IF EXISTS "project_memory_topic_bounded";
--> statement-breakpoint
ALTER TABLE "personal_memory" DROP CONSTRAINT IF EXISTS "personal_memory_topic_bounded";
--> statement-breakpoint
ALTER TABLE "project_memory" DROP COLUMN IF EXISTS "topic";
--> statement-breakpoint
ALTER TABLE "personal_memory" DROP COLUMN IF EXISTS "topic";
