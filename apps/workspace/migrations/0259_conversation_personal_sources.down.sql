-- Undo 0259. ORDER: roll the frontend back first; the newer build writes the record.
--
-- Lossy: sharing a chat that drew on personal material no longer asks first.
DROP TABLE IF EXISTS "conversation_personal_sources";
