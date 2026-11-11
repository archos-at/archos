-- Reverse 0225. ORDER: roll the frontend and the agent back first; the newer
-- builds read and write `personal_memory` on every turn.
--
-- LOSSY: every personal note is deleted. Nothing else referenced them.
DROP TABLE IF EXISTS "personal_memory";
