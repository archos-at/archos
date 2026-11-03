---
status: accepted
date: 2026-11-03
decision-makers: Platform
consulted: product owner
informed: everyone working in this repo
---

# Background work runs on self-hosted Hatchet, with fairness keyed on the organization, in place of our claim queues

## Context and Problem Statement

Since ADR-0021, ADR-0076 and ADR-0079 we ran every background path on queues we
built ourselves: `ingest_job_queue`, `research_job_queue` and `bff_job_queue`,
each with its own claim (`FOR UPDATE SKIP LOCKED`), heartbeats, stale-claim
reaping, attempt limits and dead rows; a per-office fair claim order; a
fleet-wide vision slot pool on Dragonfly (`common.lease_slots`); a sweep that
retries transient failures; a scheduler container that ticked every 30 s; and
status that the BFF pulls and reconciles when someone reads a list. That is a
workflow engine, written and kept by us, in two languages (ADR-0079: "two
implementations of one algorithm").

The bulk upload of 2026-11-02 measured where it fails. One office uploaded 556
files; production ran 16 concurrent ingest slots (8 `ingest-worker` pods x 2).

* **109 runs failed with no recorded reason.** The single SeaweedFS pod (1 GiB
  limit) went from a working set of 226 MB to 1,062 MB and restarted 5 times in
  15 minutes. Every download in those seconds failed, the job recorded no
  cause, and the BFF sweep retried the files only 5 and 10 minutes later. The
  object store's memory is fixed separately (#1462, 4 GiB; ADR-0043 is the
  split topology). What is ours to fix is that a transient failure had no
  immediate retry and no reason on record.
* **59 PDFs were read in about 18 s each and reported as about 21,600 s.** The
  18 s is the p50 of their `ingest-file` traces in Langfuse; the 21,600 s is
  `document_ingest_finished.duration_ms`. Status is pulled: nothing reconciled
  those documents until a chat turn six hours later read them
  (`docs/contributing/gotchas.md`, the two rows dated 2026-11-02).
* **Provider 402s failed ingest as a deterministic error.** The provider answers
  402 when the shared credit balance runs out; our classification treated it as
  a property of the file, so the file failed for good instead of waiting for
  the balance to come back.

Each of these is a gap in machinery a workflow engine ships: retry with backoff
per step, a recorded failure per attempt, an event when a run ends, scheduled
and cron runs. The question is which engine.

## Decision Drivers

* Operating cost at our scale. Peak load is a few task starts per second.
* Fairness across offices: one office's 556 files must not delay another
  office's single upload (the property ADR-0076 bought).
* One fleet-wide ceiling on vision calls, so more workers never mean more
  provider 429s (ADR-0076, ADR-0081).
* One engine for ingest, research runs, BFF jobs and schedules, so the
  algorithm exists once and not per language.
* Less code of our own: the change should remove more than it adds.
* No tenant content in a third party's database, even one we host.
* A real exit: the pipeline must not be written in one engine's SDK.
* AI-native (`docs/contributing/ai-native-tooling.md`): an agent can inspect,
  trigger and replay runs.

## Considered Options

1. **Hatchet, self-hosted.**
2. **Temporal, self-hosted.**
3. **Temporal Cloud.**
4. **DBOS** (durable workflows as a library over Postgres).
5. **The status quo**: keep and extend our claim queues.

## Decision Outcome

Chosen option 1, Hatchet self-hosted, because at our load it covers fairness,
retries, run events and schedules with one engine, and costs the fewest moving
parts to run. It replaces the claim queues in this change; there is no flag and
no second path.

**Shape in production.** Runbook: [`docs/deployment/hatchet.md`](../deployment/hatchet.md).

* The `hatchet-ha` Helm chart 0.21.0 with engine v0.114.2 (`hatchetChartVersion`,
  `hatchetImageTag`, through the chart's `sharedConfig.image.tag`): API, gRPC
  engine, controllers and scheduler as separate Deployments, 2 replicas each,
  each with a PodDisruptionBudget. `hatchet-lite` at the same tag runs only in
  Compose and CI. SDKs: Python `hatchet-sdk` 1.44.0, TypeScript
  `@hatchet-dev/typescript-sdk` 1.46.0.
* It runs in its own namespace, `background-work`. The chart's setup and
  worker-token Jobs add `SYS_PTRACE`, which the app namespace's `baseline` Pod
  Security Standard rejects, and the chart's Role lets the API read every Secret
  in its namespace. A Job copies the worker token into the app namespace.
* The message queue is RabbitMQ, on the owner's decision: Hatchet's HA guide and
  its production Compose both use it. It runs as `hatchet-rabbitmq`, a
  three-node `RabbitmqCluster` under the official RabbitMQ Cluster Operator,
  with a PDB, so it keeps quorum through one node's loss.
* Hatchet's database is its own CloudNativePG cluster, `background-work-pg`
  (2 instances, database and role `hatchet`), not the app cluster, so engine
  load cannot slow the app's queries. Run retention is 14 days (Hatchet's
  default is 30). Its PITR archive goes to an off-cluster bucket when a stack
  turns it on (`backgroundWorkPgBackup*`, off by default).

**Tasks.**

* `ingest-document` is a two-step DAG, `index` then `settle`, with
  `settle-failed` as its failure handler. `index` stays one step because the
  adapter holds a file's pages, text and chunks in memory from download to write
  (`LlamaIndexIngestor._ingest_job`), so "written" is the only boundary that
  can be saved cheaply. A repeated `index` is cheap where it costs most: every
  vision and transcription result is cached by content hash for 30 days.
  `settle` has retries of its own, so a BFF that is away for a moment costs a
  retried call, never a re-indexed file.
* `research-run`: a compare-and-set on `job_info` takes ownership before the
  agent runs (`jobs/run_ownership.py`), because Hatchet delivers at least once
  and a lost worker's task can run twice. A run past its execution timeout, or
  out of attempts, is recorded as FAILURE by the on-failure task.
* `bff-job`: one task, the job kind in its input.
* The scheduler container is gone. Each automation (`task_definitions`) has one
  Hatchet scheduled run at its next due time, computed in the office's time
  zone, because Hatchet crons take no time zone; migration 0192 adds
  `task_definitions.scheduled_run_id`. A fire is idempotent per due time, and
  `schedule-repair` re-schedules a definition whose run went missing. The
  maintenance sweeps are Hatchet cron tasks on the `bff-jobs` worker, one each,
  never overlapping; the 06:45 Vienna reminder runs hourly and gates itself on
  the office clock, so it stays on 06:45 across daylight-saving changes.
* The worker pools keep their names: `ingest-worker`, `agent-worker`,
  `bff-jobs`. KEDA scales each on its workflow's backlog in Hatchet's tables:
  the runs in `v1_queue_item` plus those in `v1_task_runtime`
  (`hatchetBacklogQuery`, `app/keda-scaling.ts`). A run held back by its
  organization's limit is in neither, so it asks for no replica it could not use.

**Fairness and the ceiling.**

* Each task carries `GROUP_ROUND_ROBIN` keyed on `input.organization_id`, with
  `max_runs` per organization (`INGEST_MAX_PER_ORG`, `MAX_ACTIVE_JOBS_PER_ORG`):
  a free slot goes to the organizations in turn. This replaces ADR-0076's lane
  order.
* Interactive work goes before bulk inside an organization through run
  priority (`Priority.HIGH` and `LOW`), replacing ADR-0079's priority column.
* The fleet-wide vision ceiling stays the Dragonfly lease pool. A constant
  concurrency key would cap only one task definition
  (hatchet-dev/hatchet#4237), and page reading is not its own task.

**Inputs carry no tenant content.** A run input holds ids, the organization,
the priority and our already-encrypted payload (`payload_crypto`, under
`JOB_PAYLOAD_KEK`), never document text or file names. Hatchet's database, its
dashboard and its backups hold nothing an office wrote.

**The engine stays replaceable.** The pipeline's step functions never import
`hatchet_sdk`. One thin layer per tier declares the tasks
(`knowledge/ingest_hatchet.py`, `jobs/research_hatchet.py`,
`bff/jobs-queue/hatchet*.ts`, `bff/scheduling/tasks.ts`), and the Python process
builds its one client in `agent.common.hatchet_client`. Moving to Temporal means
rewriting those layers, not the pipeline.

**Status is pushed.** When an ingest job ends, `settle` calls
`POST /api/internal/ingest/settled` with the job ids (1 to 200). The BFF runs
its existing reconcile for those documents, which emits
`document_ingest_finished` once, with `processing_ms` and `settled_by` (`push`,
`read` or `sweep`). The read and the sweep stay as fallbacks.

**Cutover.** Apply the platform, deploy, then run
`python -m agent.knowledge.ingest_cutover` (an ingest worker also runs it every
minute from boot while `ingest_job_queue` holds jobs, since API pods on the old
release write it until the rollout ends) and `python -m agent_host.jobs.requeue_legacy` to re-submit what the
old ingest and research tables still hold. BFF jobs are re-dispatched by their
own sweep, and automations by `schedule-repair`. The old tables are no longer
written and stay until a later migration drops them. Rollback is reverting the
change: the previous release still claims from those tables.

### Consequences

* Good, because claim, heartbeat, reclaim, attempt limits, backoff and per-step
  retries are the engine's, and each attempt's error is recorded on the run.
  A download that fails while the object store restarts is retried in seconds,
  not at the next sweep.
* Good, because fairness and priority are one declaration on each task instead
  of a ranking query in Python and another in TypeScript, and the scheduler
  container and its 30 s tick are gone.
* Good, because status reaches the document when the job ends.
* Good, because the dashboard and REST API show every run, its input, attempts
  and timing, which took a `SELECT` on three tables before.
* Bad, because it is a new stateful platform to run: four Deployments, a
  three-node RabbitMQ, a second Postgres cluster, their backups and upgrades.
* Bad, because Hatchet v1 dates from 2025. It is younger than Temporal, and an
  engine bug is ours to diagnose. There is no flag to fall back on: the way
  back is reverting the release, and runs already started on Hatchet finish
  only once a release that runs on Hatchet is back.
* Bad, because the KEDA query reads Hatchet's internal tables, which can change
  between releases. The image tag is pinned, and the query is checked against
  the schema of that tag (`keda-scaling.spec.ts`); an upgrade re-checks it.
* Bad, because a concurrency key is scoped to one task (hatchet-dev/hatchet#4237,
  closed as not planned on 2026-09-23). A limit meant to span two task
  definitions does not; whoever splits a task must keep its strategies on the
  task that does the capped work.
* Bad, because Hatchet delivers at least once. Research guards with an
  ownership compare-and-set; ingest relies on re-indexing replacing a file's
  chunks, and on one live run per job id (status-based idempotency on
  `input.job_id`).
* Neutral: finer ingest steps and page fan-out are future work. They need the
  parsed document persisted between steps, and they would undo ADR-0117's one
  worker per document.
* Neutral: ADR-0021 is superseded in part. Its submission writing a record,
  cancel as a status flip read by the `CancellationMonitor`, and event
  streaming from shared Postgres stand. Its claim, heartbeat and reclaim
  (points 2 and 4) are Hatchet's. Its status stays accepted.
* Neutral: ADR-0117 stands. "One document is one claim on one worker" reads as
  "one document is one `ingest-document` run"; its page pipeline runs inside
  `index` unchanged.
* Neutral: ADR-0043 is unaffected; it is the fix for the object store's memory.

### Confirmation

* **The engine tests in CI.** The `Hatchet engine tests` job (`ci.yml`) starts
  `hatchet-lite` v0.114.2 and runs the ingest workflow, the research run and
  every `bff/*/hatchet.integration.spec.ts` (BFF jobs and scheduling) against
  it, then fails if any suite was skipped (`ci/hatchet_engine.sh require-ran`),
  because each suite skips without an engine.
* **One version.** `tests/test_ci_workflows.py` holds the `hatchet-lite` tag in
  `ci/hatchet_engine.sh` and Compose to `HATCHET_IMAGE_TAG`
  (`deploy/pulumi/src/config/background-work.ts`), so CI tests the engine
  production runs.
* **Scaling.** `deploy/pulumi/src/app/keda-scaling.spec.ts` holds the backlog
  query to Hatchet's tables and each pool's workflow.
* **One client.** `agent.common.hatchet_client` is the only place a Python
  process builds the SDK client; `test_hatchet_client.py` holds that tests
  replace it there.
* **Before the production cutover**, on staging, recorded in the PR or the
  release that does it:
  1. Replay a 556-file burst from one office plus one single upload from
     another. The single upload starts within seconds.
  2. Page reading never runs more than 32 at once.
  3. Killing a worker, an engine replica or a RabbitMQ node loses no file.
  4. `background-work-pg` CPU stays under 50 %.
  5. App latency is unchanged.
  6. Status arrives by push (`settled_by: push`).
  7. `task be:eval:answer-suite` runs before and after, and the report is
     attached.
* Nothing enforces "no tenant content in a run input" mechanically; each
  tier's input model holds ids and ciphertext only, and review is the gate.

## Pros and Cons of the Options

### Hatchet, self-hosted

* Good, because `GROUP_ROUND_ROBIN` with a CEL key (`input.organization_id`) is
  the per-office fairness we built by hand
  (docs.hatchet.run/v1/concurrency, read 2026-11-03).
* Good, because its docs give "hundreds of events and workflow runs per
  second" on a 4 CPU, 8 GB database
  (docs.hatchet.run/self-hosting/improving-performance, read 2026-11-03), far
  past our peak of a few task starts per second.
* Good, because one engine and one SDK per language serves every tier,
  scheduled runs and crons included.
* Bad, because a concurrency key does not span task definitions (#4237).
* Bad, because v1 is from 2025 and has a shorter production record than
  Temporal.
* Bad, because its crons are UTC only, so a schedule in an office's time zone
  is ours to compute.

### Temporal, self-hosted

* Good, because it is the most mature option, with years of production use at a
  scale far past ours.
* Bad, because it is four services (frontend, history, matching, worker) plus
  its persistence.
* Bad, because upgrades go one minor version at a time with a schema migration
  before each (docs.temporal.io/self-hosted-guide/upgrade-server, read
  2026-11-03), and the history shard count is fixed when the cluster is
  created.
* Bad, because it has no global concurrency cap, and fairness keys have been
  generally available only since 2026-05-05
  (temporal.io/changelog/priority-fairness-generally-available).
* Premise of the rejection: the operating cost of four services and sequential
  upgrades at a load of a few task starts per second. If our load grows past
  what one Hatchet installation handles, or a Hatchet defect costs us more than
  that operating cost, re-check. Temporal is the documented exit, which is why
  step functions never import an SDK.

### Temporal Cloud

* Good, because it removes the operating cost that rules out self-hosted
  Temporal.
* Bad, because run inputs, histories and metadata would live with a third
  party, and the platform decision is to self-host background work.
* Premise of the rejection: the decision to self-host. If that changes, this
  option is the first to re-check.

### DBOS

* Good, because it is a library over Postgres, with no engine to run.
* Bad, because its durable execution runs inside our own processes and writes
  to the database it is pointed at: either the app's Postgres takes the
  engine's load, or we run a second cluster anyway and gain little over an
  engine.
* Bad, because we did not find, in its documentation read on 2026-11-03,
  dispatch that rotates fairly across a group key as configuration. This was a
  reading, not a trial.
* Premise of the rejection: that reading. If DBOS queues offer group-fair
  dispatch, re-check; it would remove the engine Deployments this decision adds.

### The status quo

* Good, because it was running, tested and known.
* Bad, because every gap measured on 2026-11-02 (no reason on a failed run,
  retries only at the sweep, status only on read) is more machinery to write,
  twice, in Python and TypeScript.
* Premise of the rejection: the cost of growing our own engine in two languages,
  shown by the 2026-11-02 measurements.

### Postgres as Hatchet's only message queue

Hatchet can run without RabbitMQ (docs.hatchet.run/self-hosting, read
2026-11-03, lists it as optional), and at our load that would spare three
stateful pods. Rejected on the owner's decision, on the premise that Hatchet's
HA guide (docs.hatchet.run/self-hosting/high-availability, read 2026-11-03)
and its production Compose document RabbitMQ only, so a Postgres-only HA
install is the less-trodden path. If Hatchet documents Postgres-only as its HA
setup, re-check and drop RabbitMQ.

## More Information

* Supersedes ADR-0076 (ingestion's fair claim queue) and ADR-0079 (one claim
  substrate for all background work). Supersedes ADR-0021 in part (see
  Consequences). Related: ADR-0043, ADR-0081, ADR-0117.
* Sources, each read on 2026-11-03:
  [self-hosting](https://docs.hatchet.run/self-hosting),
  [high availability](https://docs.hatchet.run/self-hosting/high-availability),
  [concurrency](https://docs.hatchet.run/v1/concurrency),
  [improving performance](https://docs.hatchet.run/self-hosting/improving-performance),
  [hatchet-dev/hatchet#4237](https://github.com/hatchet-dev/hatchet/issues/4237),
  [Temporal priority and fairness GA, 2026-05-05](https://temporal.io/changelog/priority-fairness-generally-available),
  [Temporal server upgrades](https://docs.temporal.io/self-hosted-guide/upgrade-server).
  The Postgres-only launch post (`hatchet.run/launch-week-01/pg-only-mode`)
  answered 404 on 2026-11-03.
* Revisit when: `background-work-pg` CPU passes 50 % at normal load; RabbitMQ
  queue depth stays over 1,000 (the `RabbitmqQueueDepth` rule); Hatchet ships
  shared concurrency across tasks (#4237's request), which would let the vision
  ceiling move into the engine; or an engine defect costs a production incident
  the claim queues would not have had.

### AI-native check (2026-11-03)

| # | Criterion | Result | Evidence (source, date) |
|---|---|---|---|
| 1 | Official agent surface | yes: a documented REST API and official SDKs (Python, TypeScript, Go); the Hatchet CLI ships a local MCP server over stdio (`hatchet mcp serve`) that triggers, inspects and replays runs and lists workers | docs.hatchet.run/reference/cli/mcp, 2026-11-03. The MCP server is not yet tried against our engine: unverified here |
| 2 | Scoped credentials | partly: API tokens per tenant, revocable; the MCP server uses only CLI profiles explicitly granted. No read-only token role found | Hatchet docs, 2026-11-03 |
| 3 | Schema and configuration as code | yes: the chart values, RabbitMQ and the cluster in `deploy/pulumi`; tasks, concurrency, priority, schedules and crons are declared in our code and registered by the workers | |
| 4 | Audit and rollback of agent edits | partly: every run and attempt is kept for the retention window (14 days on our setting) and a run can be replayed; there are no drafts, because a triggered run is the edit | |
| 5 | Events | partly: run events through the API and SDK; our own push to `/api/internal/ingest/settled` carries what the BFF needs | |
| 6 | CLI | yes: the Hatchet CLI | docs.hatchet.run/reference/cli, 2026-11-03 |
| 7 | Exit | yes: the step functions do not import the SDK; Temporal is the named exit | this ADR |

Round trip done by: nobody yet. It is part of the staging check: connect the CLI's
MCP server to the staging engine with a granted profile, trigger an
`ingest-document` run for a test office, inspect it, and replay it.
Agent surfaces in use: the SDKs for our workers; the dashboard (port-forward,
runbook) and the CLI's MCP server for Claude Code.
Exceptions: line 2 (no read-only role found) and line 4 (no draft step), accepted
because agents operate this engine for us and hold no tenant content in it;
re-check with the staging round trip.
