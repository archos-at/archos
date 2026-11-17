-- A model's extraction lands only on the run that started it.
--
-- `bim_models` holds one row per document, and a re-ingest reuses the row.
-- Two extractions of one document can run side by side: a new version's bytes
-- queue their own `bim_extract` job (the open-job match includes the storage
-- key) while the job for the old bytes is still parsing. Nothing on the row
-- said which of them it was waiting for, so the slower one wrote last: the old
-- file's elements under `ready`, or `failed` over a model that had just been
-- read. `run_id` is that missing fact. `start` writes a fresh one, and
-- `complete` and `fail` match on it (`bff/bim/extraction-repository.ts`).
--
-- Existing rows keep NULL, in every state. A `ready` or `failed` row needs no
-- run: the next `start` gives it one. An `extracting` row whose job runs on
-- the image before this one is finished by that image, which does not look at
-- the column; if that job is retried on this image it starts again and takes a
-- run id then. No row is rewritten, so the ALTER is a catalog change only.
ALTER TABLE "bim_models" ADD COLUMN IF NOT EXISTS "run_id" uuid;

COMMENT ON COLUMN "bim_models"."run_id" IS
  'The extraction run this row currently waits for or last heard from. Written by start; complete and fail match on it, so a superseded run changes nothing.';

-- The status vocabulary, held by the database (`BIM_MODEL_STATUSES` in
-- `bff/bim/types.ts`; the schema's CHECK is generated from that tuple).
-- NOT VALID: the three writers have only ever written these values, but the
-- column was free text since 0034 and a row nobody knows of must not stop a
-- deploy. Every insert and every later update is checked; existing rows are
-- not read.
ALTER TABLE "bim_models" DROP CONSTRAINT IF EXISTS bim_models_status_known;
ALTER TABLE "bim_models" ADD CONSTRAINT bim_models_status_known
  CHECK (status IN ('pending', 'extracting', 'ready', 'failed')) NOT VALID;
