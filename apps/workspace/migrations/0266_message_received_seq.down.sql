-- Undo 0266. ORDER: roll the frontend back first; the newer build reads the column.
-- The sequence is owned by the column and goes with it.
ALTER TABLE "messages" DROP COLUMN IF EXISTS "received_seq";
