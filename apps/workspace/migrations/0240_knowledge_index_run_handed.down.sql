-- Reverse 0240. ORDER: roll the frontend back first; this build writes `handed_at`.
-- LOSSY: when each run handed its text on goes; a retried run then re-ingests, as before 0240.
ALTER TABLE "knowledge_index_runs" DROP COLUMN IF EXISTS "handed_at";
