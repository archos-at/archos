-- Reverse 0234. ORDER: roll the frontend back first; this build reads and
-- writes the table. LOSSY: every stored question and answer is dropped, and a
-- run that was waiting on one stays `waiting` in its ledger until it ends.
DROP TABLE IF EXISTS "run_input_requests";
