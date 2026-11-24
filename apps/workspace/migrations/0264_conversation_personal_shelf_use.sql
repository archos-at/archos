-- 0264: a chat records that it drew on its owner's own shelf (ADR-0193 rule 5).
--
-- Set, under the audience lock, the first time a turn of a solo chat without a
-- project actually reads from „Meine Ablage“. Sharing such a chat asks its owner
-- first. Like `conversation_source_projects`, it records the use, not the files.
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "personal_shelf_used_at" timestamp with time zone;
