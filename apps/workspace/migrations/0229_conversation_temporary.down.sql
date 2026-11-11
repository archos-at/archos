-- Reverse 0229. ORDER: roll the frontend and the agent back first; the newer
-- builds read `conversations.temporary` on every turn and every memory write.
--
-- LOSSY: which conversations were temporary is forgotten, so memory is kept
-- from them again from the next turn on. Nothing is kept retroactively.
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "temporary";
