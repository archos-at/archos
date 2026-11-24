---
status: proposed
date: 2026-11-24
decision-makers: Grid engineering
consulted: product owner
informed: everyone working in this repo
---

# Runs are listed from the run ledger, and the backend's job store lists nothing

## Context and Problem Statement

The chat history's "Deep Research" section read `GET /v1/jobs/async/jobs`, the
agent host's job store, through the BFF's job proxy. That store is execution
state: one row per queued job, of any agent, in the runtime's own status words.
On dev (2026-11-24) the section of one project showed twelve runs as "Läuft",
the oldest two months old, while `task_runs` had every one of them `succeeded`
or `failed`. Customers without the deep-research entitlement saw the section
too. Three faults stacked, and each came from reading the wrong store:

- The store writes `success` / `failure` / `interrupted` (`JobStatus.value`);
  the section knew only `completed` / `failed` / `cancelled` and called
  everything else running. Its specs fed it `completed`, a word the backend
  never sends.
- The store's expiry matched `SUCCESS` / `FAILURE` / `INTERRUPTED`. Postgres
  compares case-sensitively, so no finished job ever expired, and the 24-hour
  retention ADR-0051 relies on never happened. Its test inserted the same
  uppercase words.
- `job_access` has no agent type, so the list held project-intake readings
  (started by every upload, ADR-0111) and task runs beside deep research, and
  the section never asked for the entitlement.

ADR-0051 already made `task_runs` the durable record of delegated work and
ADR-0062 made a run a message in its thread. The section was the last surface
still reading the job store as if it were that record.

## Decision Drivers

* One truth per fact. A run's kind, title, thread, requester and status are
  already on `task_runs`, under RLS, in the product's vocabulary, healed by the
  run reconciler (`bff/runs/reconcile.ts`).
* The job store must be free to forget: its rows hold execution detail and
  report payloads that ADR-0051 already moved to the ledger and the documents.
* A vocabulary is spelled where it is written, never retyped by a reader.

## Considered Options

* **Patch the reader**: translate the runtime's statuses in the section, add an
  `agent_type` column to `job_access`, filter by it, gate the section.
* **List from the ledger**: the section reads `GET /api/projects/{id}/runs?kind=deep-research`;
  the job store's list route, its BFF proxy branch and its client go.

## Decision Outcome

Chosen option: "List from the ledger", because every field the section needs
already lives there in product words, and the patch would keep a second list
whose rows outlive their meaning (a finished job's row says nothing the ledger
does not, once the reconciler has copied its verdict).

- The section reads the ledger and labels a status with the same copy and badge
  as the task run history (`RUN_STATUS_VARIANT`, `tasks` copy `status.*`).
- `kind=deep-research` on the run list asks for the deep-research entitlement;
  `403 feature_disabled` hides the section and its filter.
- Stopping a run goes through `POST /api/projects/{id}/runs/{runId}/cancel`,
  which closes the ledger row too, not through the job cancel that bypassed it.
- The agent host keeps per-job routes (status, stream, state, report and the
  controls, ADR-0084) and lists nothing. The BFF's job proxy answers `404` for
  the list path and names the run list instead.
- The store's expiry reads its terminal statuses from the runtime's `JobStatus`
  (`jobs/terminal.py`), the one definition the status writer also uses.

### Consequences

* Good, because a run reads the same in the history, the task panel and its
  thread, and a project-intake reading no longer appears as a run.
* Good, because the job store's retention finally works, so it stops growing.
* Bad, because the first expiry pass after the deploy deletes every finished
  job older than its expiry plus `JOB_INFO_DELETE_GRACE_SECONDS` in every
  organization at once. Nothing reads those rows: the reconciler treats a
  missing job as handled, and a report lives in its run message and filed
  document. A pre-ledger report nobody opened is lost, as the history's footer
  ("Rechercheberichte können auf dem Server ablaufen") has always said.
* Bad, because a deep-research job submitted without a `task_runs` row is now
  invisible in the history. No product path does that since ADR-0062; the
  job proxy's direct `submit` has no caller in the UI.

### Confirmation

* `app/api/jobs/async/[...path]/route.spec.ts`: the list path answers `404`
  without an upstream request.
* `app/api/projects/[id]/runs/route.list.spec.ts`: `kind=deep-research` is gated
  on the deep-research entitlement; an unknown kind is `400`.
* `tests/test_expire_terminal_jobs.py` writes its jobs through the runtime's
  `JobStore`, so a status vocabulary the store does not write cannot pass.
* The section's specs build runs from `TaskRunView` with every ledger status.

## More Information

Revisit if a surface needs runs the ledger does not record (a job with no
`task_runs` row by design); give it a ledger row rather than a job-store list.
