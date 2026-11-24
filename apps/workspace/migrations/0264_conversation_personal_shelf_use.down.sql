-- Undo 0264. ORDER: roll the frontend back first; the newer build reads the column.
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "personal_shelf_used_at";
