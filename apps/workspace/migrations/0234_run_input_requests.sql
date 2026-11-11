-- A run's question to a person, and the answer (ADR-0181).
--
-- A run (task_runs) that cannot go on without a person stores a row here: what
-- it asks (a message and a flat schema of primitives, as MCP form elicitation
-- shapes it), why (AG-UI's interrupt reasons), and how it ended. The run
-- ledger's `waiting` status had no producer until this table existed.
--
-- The CHECKs carry the lifecycle (`INPUT_REQUEST_LIFECYCLE`,
-- bff/runs/input-request-types.ts): decided exactly when it left `open`, a
-- deciding person exactly on `answered` and `declined`, an answer exactly on
-- `answered`. Additive: no existing table or column changes.
CREATE TABLE IF NOT EXISTS "run_input_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "run_id" uuid NOT NULL REFERENCES "task_runs"("id") ON DELETE CASCADE,
  "idempotency_key" text NOT NULL,
  "reason" text NOT NULL,
  "message" text NOT NULL,
  "requested_schema" jsonb NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "content" jsonb,
  "decided_by" text,
  "decided_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "run_input_requests_project_fk"
    FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT run_input_requests_status_known
    CHECK ("status" IN ('open', 'answered', 'declined', 'cancelled', 'expired')),
  CONSTRAINT run_input_requests_reason_known
    CHECK ("reason" IN ('input_required', 'confirmation')),
  CONSTRAINT run_input_requests_message_bounded
    CHECK (char_length("message") BETWEEN 1 AND 2000),
  CONSTRAINT run_input_requests_schema_is_object
    CHECK (jsonb_typeof("requested_schema") = 'object'),
  CONSTRAINT run_input_requests_decided_when_closed
    CHECK (("status" <> 'open') = ("decided_at" IS NOT NULL)),
  CONSTRAINT run_input_requests_person_decides
    CHECK (("status" IN ('answered', 'declined')) = ("decided_by" IS NOT NULL)),
  CONSTRAINT run_input_requests_content_when_answered
    CHECK (("status" = 'answered') = ("content" IS NOT NULL)),
  CONSTRAINT run_input_requests_content_is_object
    CHECK ("content" IS NULL OR jsonb_typeof("content") = 'object')
);
--> statement-breakpoint
-- One question per key and run: a retried post finds the request it made.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_run_input_requests_run_key"
  ON "run_input_requests" ("run_id", "idempotency_key");
--> statement-breakpoint
-- A run's requests, newest first: the list every reader of the run asks for.
CREATE INDEX IF NOT EXISTS "idx_run_input_requests_run_created"
  ON "run_input_requests" ("run_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_run_input_requests_organization_id"
  ON "run_input_requests" ("organization_id");
--> statement-breakpoint
-- Keyed by its organization AND the run's: a row cannot be planted on another
-- tenant's run, nor on a run of another project.
SELECT grid_secure_table('run_input_requests',
  'organization_id = grid_current_org() AND EXISTS (SELECT 1 FROM task_runs r WHERE r.id = run_id AND r.organization_id = grid_current_org() AND r.project_id = run_input_requests.project_id)');
