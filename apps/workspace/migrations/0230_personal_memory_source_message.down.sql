-- Reverse 0230. ORDER: roll the frontend and the agent back first; the newer
-- builds write and filter on `personal_memory.source_message_id`.
--
-- LOSSY: which answer a personal note was saved under is forgotten, so the
-- note no longer shows under that answer. The notes themselves stay.
ALTER TABLE "personal_memory" DROP COLUMN IF EXISTS "source_message_id";
