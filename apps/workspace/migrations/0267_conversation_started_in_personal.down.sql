-- Undo 0267. ORDER: roll the frontend back first; the newer build reads the column.
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "started_in_personal";
