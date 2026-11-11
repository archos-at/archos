-- Reverse 0226: the four tables exist again, empty, with the columns, checks,
-- indexes, foreign keys and policies they had before it. What they held is not
-- restored: the lane turns were scheduling state of a claim that is gone, and
-- the rows of `jobs`, `job_runs` and `tasks` live on in `task_definitions` and
-- `task_runs` since 0086. So reversing 0086 after this finds no job for a
-- conversation to name and clears every `conversations.job_id`, which is the
-- fallback its own down documents.
CREATE TABLE IF NOT EXISTS "bff_job_lane_turns" (
  "lane" text PRIMARY KEY NOT NULL,
  "last_claimed_at" timestamp with time zone
);
--> statement-breakpoint
SELECT secure_table('bff_job_lane_turns', 'lane = current_org()');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL,
  "name" text NOT NULL,
  "prompt" text NOT NULL,
  "skill_name" text,
  "skill_snapshot" jsonb,
  "output" text NOT NULL,
  "data_sources" jsonb,
  "enabled" boolean DEFAULT true NOT NULL,
  "schedule_cron" text,
  "schedule_timezone" text DEFAULT 'UTC' NOT NULL,
  "next_run_at" timestamp with time zone,
  "last_run_at" timestamp with time zone,
  "created_by" text NOT NULL,
  "created_by_email" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "jobs_skill_pair_check" CHECK (("skill_name" IS NULL) = ("skill_snapshot" IS NULL))
);
--> statement-breakpoint
COMMENT ON COLUMN "jobs"."prompt" IS
  'The scheduled prompt. Fires as if typed into a new chat; the attached skill body, when there is one, is appended by the shared prompt builder.';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jobs_project_id" ON "jobs" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jobs_organization_id" ON "jobs" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jobs_due" ON "jobs" ("next_run_at")
  WHERE "schedule_cron" IS NOT NULL AND "enabled";
--> statement-breakpoint
SELECT secure_table('jobs',
  'organization_id = current_org() AND EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = current_org())');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "schedule_id" uuid NOT NULL REFERENCES "jobs"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL,
  "organization_id" text NOT NULL,
  "job_id" text,
  "trigger" text NOT NULL,
  "status" text NOT NULL,
  "detail" text,
  "conversation_id" text,
  "skill_snapshot" jsonb NOT NULL,
  "triggered_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "job_runs_conversation_id_organization_id_fkey"
    FOREIGN KEY ("conversation_id", "organization_id")
    REFERENCES "conversations" ("id", "organization_id")
    ON DELETE SET NULL ("conversation_id")
);
--> statement-breakpoint
COMMENT ON COLUMN "job_runs"."schedule_id" IS
  'FK to jobs.id — the job this run belongs to. NOT renamed to job_id in 0043 because job_id on this table is the unrelated backend async-job id.';
--> statement-breakpoint
COMMENT ON COLUMN "job_runs"."job_id" IS
  'Backend async-job id for the submitted run (NULL when skipped/error). NOT a reference to jobs.id — that is schedule_id.';
--> statement-breakpoint
COMMENT ON COLUMN "job_runs"."conversation_id" IS
  'Conversation a finished output=chat run was materialised into; NULL for deep-research, skipped/error, and pre-0043 runs.';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_runs_job_created" ON "job_runs" ("schedule_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_runs_backend_job_id" ON "job_runs" ("job_id") WHERE "job_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_runs_project_id" ON "job_runs" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_runs_organization_id" ON "job_runs" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_runs_created_at" ON "job_runs" ("created_at");
--> statement-breakpoint
SELECT secure_table('job_runs',
  'organization_id = current_org() AND EXISTS (SELECT 1 FROM jobs j WHERE j.id = schedule_id AND j.organization_id = current_org())');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "plan" jsonb NOT NULL,
  "requester_user_id" text NOT NULL,
  "requester_email" text,
  "status" text DEFAULT 'queued' NOT NULL,
  "error" text,
  "budget_usd" numeric(12, 4),
  "deadline_at" timestamp with time zone,
  "job_id" uuid REFERENCES "jobs"("id") ON DELETE SET NULL,
  "job_run_id" uuid REFERENCES "job_runs"("id") ON DELETE SET NULL,
  "backend_job_id" text,
  "conversation_id" text,
  "filed_document_id" uuid,
  "filing_status" text,
  "filing_detail" text,
  "review" text,
  "review_reason" text,
  "reviewed_by" text,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tasks_status_known"
    CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'interrupted')),
  CONSTRAINT "tasks_review_known"
    CHECK ("review" IS NULL OR "review" IN ('accepted', 'rejected')),
  CONSTRAINT "tasks_filing_status_known"
    CHECK ("filing_status" IS NULL OR "filing_status" IN ('filed', 'refused', 'failed')),
  CONSTRAINT "tasks_review_complete"
    CHECK (("review" IS NULL) = ("reviewed_by" IS NULL) AND ("review" IS NULL) = ("reviewed_at" IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_project_created" ON "tasks" ("project_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_organization_id" ON "tasks" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_job_id" ON "tasks" ("job_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_tasks_backend_job_id"
  ON "tasks" ("backend_job_id") WHERE "backend_job_id" IS NOT NULL;
--> statement-breakpoint
SELECT secure_table('tasks',
  'organization_id = current_org() AND EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = current_org())');
