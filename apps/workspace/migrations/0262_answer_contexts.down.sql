-- Undo 0262. ORDER: roll the frontend back first; the newer build writes the table.
-- Lossy: the per-answer records are gone.
DROP TABLE IF EXISTS "answer_contexts";
