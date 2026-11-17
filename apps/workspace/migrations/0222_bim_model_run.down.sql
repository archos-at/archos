-- Reverse 0222. ORDER: roll the frontend back first; the newer build writes
-- and matches on the column.
--
-- Without it a superseded extraction can again write over a newer one.
ALTER TABLE "bim_models" DROP CONSTRAINT IF EXISTS bim_models_status_known;
ALTER TABLE "bim_models" DROP COLUMN IF EXISTS "run_id";
