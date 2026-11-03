---
status: accepted
date: 2026-11-03
decision-makers: Platform
consulted: product owner
informed: everyone working in this repo
---

# Background work runs on self-hosted Hatchet, with fairness keyed on the organization, behind a flag per tier

## Context and Problem Statement

Since ADR-0021, ADR-0076 and ADR-0079 we run every background path on queues we
built ourselves: `ingest_job_queue`, `research_job_queue` and `bff_job_queue`,
each with its own claim (`FOR UPDATE SKIP LOCKED`), heartbeats, stale-claim
reaping, attempt limits and dead rows; a per-office fair claim order; a
fleet-wide vision slot pool on Dragonfly (`common.lease_slots`); a sweep that
retries transient failures; and status that the BFF pulls and reconciles when
someone reads a list. That is a workflow engine, written and kept by us, in two
languages (ADR-0079: "two implementations of one algorithm").

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
per step, a recorded failure per attempt, an event when a run ends. The
question is which engine, and how to move onto it without a big-bang cutover.

## Decision Drivers

* Operating cost at our scale. Peak load is a few task starts per second; the
  engine must not need more people or services than the work it replaces.
* Fairness across offices: one office's 556 files must not delay another
  office's single upload (the property ADR-0076 bought).
* One fleet-wide ceiling on vision calls, so more workers never mean more
  provider 429s (ADR-0076, ADR-0081).
* Postgres only. We already run CloudNativePG; a broker is one more stateful
  service to secure, back up and upgrade.
* One engine for ingest, research runs and BFF jobs, so the algorithm exists
  once and not per language.
* No tenant content in a third party's database, even one we host.
* A real exit: the pipeline must not be written in one engine's SDK.
* AI-native (`docs/contributing/ai-native-tooling.md`): an agent can inspect,
  trigger and replay runs.

## Considered Options

1. **Hatchet, self-hosted** (Postgres-backed task queue and workflow engine).
2. **Temporal, self-hosted.**
3. **Temporal Cloud.**
4. **DBOS** (durable workflows as a library over our own Postgres).
5. **The status quo**: keep and extend our claim queues.

## Decision Outcome

Chosen option 1, Hatchet self-hosted, because at our load it covers fairness,
the global ceiling, retries and run events with one engine on Postgres alone,
and costs the fewest moving parts to run.

**Shape in production.**

* The `hatchet-ha` Helm chart: API, gRPC engine, controllers and scheduler as
  separate Deployments, 2 replicas each, each with a PodDisruptionBudget. The
  image tag is pinned (`sharedConfig.image.tag`, Pulumi `hatchetImageTag`, with
  `hatchetChartVersion`); `hatchet-lite` runs only in Compose and tests. The
  platform installs only where Pulumi `hatchetEnabled` is true (default false).
* The message queue is Postgres. RabbitMQ is added only once we sustain about
  100 task starts per second, which is our threshold for re-measuring, not a
  number Hatchet publishes.
* Hatchet gets its own CloudNativePG cluster, `background-work-pg` (2 instances,
  about 2 CPU and 4 GiB each, database and role `hatchet`), not the app cluster,
  so engine load cannot slow the app's queries. Backups go off-cluster. Run
  retention is 14 days (Hatchet's default is 30).

**Tasks.** Three, one per tier: `ingest-document`, `research-run` and `bff-job`
(one task; the job kind is in the input). The worker pools keep their names:
`ingest-worker`, `agent-worker`, `bff-jobs`.

**Fairness and the ceiling.**

* Each task carries a concurrency strategy `GROUP_ROUND_ROBIN` with the key
  `input.organization_id`: when an office has more runs than its share, its
  runs wait and the next free slot rotates to the next office. This replaces
  the lane order of ADR-0076.
* Interactive work goes before bulk inside an office through Hatchet run
  priority, replacing the `interactive` / `bulk` column of ADR-0079.
* The fleet-wide vision ceiling becomes a concurrency strategy with a constant
  key and `max_runs` = the ceiling (32 today) on the task that reads pages.
  Hatchet scopes a key to one task definition (hatchet-dev/hatchet#4237), so the
  ceiling holds only while every vision call runs inside that one task. Until
  page reading is its own task, the Dragonfly lease pool stays.

**Inputs carry no tenant content.** A task input holds ids, the priority and
our already-encrypted payload (`payload_crypto`, under `JOB_PAYLOAD_KEK`),
never plaintext document text or file names. Hatchet's database, its dashboard
and its backups therefore hold nothing an office wrote.

**The engine stays replaceable.** The pipeline's step functions never import
`hatchet_sdk`. A thin layer per tier registers them as tasks, and only that
layer and `agent.common.hatchet_client` import the SDK. Moving to Temporal
means rewriting that layer, not the pipeline.

**Rollout is a flag per tier, defaulting to the claim queue.**
`INGEST_ORCHESTRATOR`, `RESEARCH_ORCHESTRATOR` and `BFF_JOBS_ORCHESTRATOR` take
`claim_queue` (default) or `hatchet`. The connection is the SDK's own
environment (`HATCHET_CLIENT_TOKEN`, `HATCHET_CLIENT_HOST_PORT`,
`HATCHET_CLIENT_TLS_STRATEGY`, `HATCHET_CLIENT_NAMESPACE` per stack). Nothing
switches until the platform is applied in a stack and the spike below has
passed there. The claim queues stay until each tier has run on Hatchet in
production; a later change deletes them.

**Status is pushed.** When an ingest job reaches a terminal status, the Python
side calls `POST /api/internal/ingest/settled` with the job ids (1 to 200).
The BFF runs its existing reconcile for those documents, which emits
`document_ingest_finished` once, now with `processing_ms` and `settled_by`
(`push`, `read` or `sweep`). The call is best effort and runs on both
orchestrators; the sweep stays as the fallback. This closes the six-hour gap
whichever engine runs the job.

### Consequences

* Good, because claim, heartbeat, reclaim, attempt limits, backoff and per-step
  retries become the engine's, and each attempt's error is recorded on the run.
  A download that fails while the object store restarts is retried in seconds,
  not at the next sweep.
* Good, because fairness and priority are one configuration on each task instead
  of a ranking query in Python and another in TypeScript.
* Good, because status reaches the document when the job ends, on either path.
* Good, because the dashboard and REST API show every run, its input, attempts
  and timing, which today takes a `SELECT` on three tables.
* Bad, because it is a new stateful platform to run: four Deployments, a second
  Postgres cluster, its backups and its upgrades.
* Bad, because Hatchet v1 dates from 2025. It is younger than Temporal, and an
  engine bug is ours to diagnose. The flags are the mitigation: each tier can go
  back to the claim queue with one value while both paths exist.
* Bad, because a concurrency key is scoped to one task (hatchet-dev/hatchet#4237,
  closed as not planned on 2026-09-23). A ceiling meant to span two task
  definitions does not; whoever splits a task must keep the constant-key
  strategy on the one task that makes the capped calls.
* Bad, because there is no native KEDA scaler for Hatchet. The KEDA
  `postgresql` trigger could count Hatchet's queue tables, but that couples our
  scaling to an internal schema that changes between Hatchet releases. On
  Hatchet the worker pools do not scale on queue depth under this decision;
  how they scale is a follow-up decision (More Information).
* Neutral: while both paths exist, the claim queue's code, tests and KEDA
  ScaledObjects stay and are maintained. That is the price of a reversible
  rollout, and it ends with the deletion PR.
* Neutral: ADR-0021 is superseded in part. Its submission writing a record,
  cancel as a status flip read by the `CancellationMonitor`, and event
  streaming from shared Postgres stand. Its claim, heartbeat and reclaim
  (points 2 and 4) move to Hatchet once `RESEARCH_ORCHESTRATOR` flips. Its
  status stays accepted.
* Neutral: ADR-0117 stands. "One document is one claim on one worker" reads as
  "one document is one `ingest-document` run"; its page pipeline runs inside
  that run unchanged.
* Neutral: ADR-0043 is unaffected; it is the fix for the object store's
  memory, which this decision does not replace.

### Confirmation

* The flags: `packages/agent/tests/common/test_hatchet_client.py` holds the
  default (`claim_queue`) and refuses an unknown value, so a typo cannot switch
  a tier. Each tier's Hatchet layer lands with a test that its step functions
  run without `hatchet_sdk` importable.
* The settle push and the new `document_ingest_finished` properties land with
  their BFF route spec.
* The spike, run on staging before any tier's flag flips in production, with
  its results recorded in the PR that flips it:
  1. Replay a 556-file burst from one office plus one single upload from
     another. The single upload starts within seconds.
  2. Page reading never runs more than 32 at once.
  3. Killing a worker, or an engine replica, loses no file.
  4. `background-work-pg` CPU stays under 50 %.
  5. App latency is unchanged.
  6. Status arrives by push (`settled_by: push`).
  7. `task be:eval:answer-suite` runs before and after, and the report is in
     the PR.
* Nothing enforces "no tenant content in a task input" mechanically yet; review
  is the gate until each tier's layer has a test on its input shape.

## Pros and Cons of the Options

### Hatchet, self-hosted

* Good, because `GROUP_ROUND_ROBIN` with a CEL key (`input.organization_id`) is
  the per-office fairness we built by hand, and a constant key gives one
  global limit (docs.hatchet.run/v1/concurrency, read 2026-11-03).
* Good, because it runs on Postgres alone; RabbitMQ is optional
  (docs.hatchet.run/self-hosting, read 2026-11-03). Its docs give "hundreds of
  events and workflow runs per second" on a 4 CPU, 8 GB database
  (docs.hatchet.run/self-hosting/improving-performance, read 2026-11-03),
  about a hundred times our peak of a few tasks per second.
* Good, because one engine and one SDK per language serves all three tiers.
* Bad, because a concurrency key does not span task definitions (#4237).
* Bad, because v1 is from 2025 and has a shorter production record than
  Temporal.

### Temporal, self-hosted

* Good, because it is the most mature option, with years of production use at a
  scale far past ours.
* Bad, because it is four services (frontend, history, matching, worker) plus
  its persistence, against Hatchet's engine and API on one Postgres.
* Bad, because upgrades go one minor version at a time with a schema migration
  before each (docs.temporal.io/self-hosted-guide/upgrade-server, read
  2026-11-03), and the history shard count is fixed when the cluster is
  created.
* Bad, because it has no global concurrency cap: the vision ceiling would stay
  ours to build. Fairness keys have been generally available only since
  2026-05-05 (temporal.io/changelog/priority-fairness-generally-available).
* Premise of the rejection: the operating cost of four services and sequential
  upgrades at a load of a few tasks per second, and the missing global cap. If
  our load grows past what Hatchet handles on Postgres, or Temporal ships a
  global cap, re-check. Temporal is the documented exit, which is why step
  functions never import an SDK.

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
  dispatch that rotates fairly across a group key together with a fleet-wide
  cap as configuration. This was a reading, not a trial.
* Premise of the rejection: that reading. If DBOS queues offer both, re-check;
  it would remove the engine Deployments this decision adds.

### The status quo

* Good, because it is running, tested and known.
* Bad, because every gap measured on 2026-11-02 (no reason on a failed run,
  retries only at the sweep, status only on read) is more machinery to write,
  twice, in Python and TypeScript.
* Premise of the rejection: the cost of growing our own engine in two languages,
  shown by the 2026-11-02 measurements. The claim queues stay until each tier
  has run on Hatchet in production.

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
  answered 404 on 2026-11-03; the claim it was cited for (Postgres-only
  operation is supported) rests on the self-hosting page instead. The HA page
  documents RabbitMQ only; that the chart runs with the Postgres queue is to be
  shown by the spike.
* Worker scaling on Hatchet, open: (a) fixed replica counts per stack, sized as
  today's `maxReplicas`; (b) KEDA's `postgresql` trigger on Hatchet's queue
  tables, re-checked on every Hatchet upgrade; (c) a scaler fed by Hatchet's
  REST API or metrics. The decision lands with the first tier that flips.
* Revisit when: sustained task starts pass about 100 per second (add RabbitMQ,
  or re-check Temporal); `background-work-pg` CPU passes 50 % at normal load;
  Hatchet ships shared concurrency across tasks (#4237's request), which would
  let the vision ceiling span tasks; or an engine defect costs a production
  incident that the claim queue would not have had.

### AI-native check (2026-11-03)

| # | Criterion | Result | Evidence (source, date) |
|---|---|---|---|
| 1 | Official agent surface | yes: a documented REST API and official SDKs (Python, TypeScript, Go); the Hatchet CLI ships a local MCP server over stdio (`hatchet mcp serve`) that triggers, inspects and replays runs and lists workers | docs.hatchet.run/reference/cli/mcp, 2026-11-03. The MCP server is not yet tried against our engine: unverified here |
| 2 | Scoped credentials | partly: API tokens per tenant, revocable; the MCP server uses only CLI profiles explicitly granted. No read-only token role found | Hatchet docs, 2026-11-03 |
| 3 | Schema and configuration as code | yes: the chart values and the cluster in `deploy/pulumi`; workflows, concurrency and priority are declared in our code and registered by the workers | |
| 4 | Audit and rollback of agent edits | partly: every run and attempt is kept for the retention window (14 days on our setting) and a run can be replayed; there are no drafts, because a triggered run is the edit | |
| 5 | Events | partly: run events through the API and SDK; our own push to `/api/internal/ingest/settled` carries what the BFF needs | |
| 6 | CLI | yes: the Hatchet CLI | docs.hatchet.run/reference/cli, 2026-11-03 |
| 7 | Exit | yes: the step functions do not import the SDK; Temporal is the named exit | this ADR |

Round trip done by: nobody yet. It is part of the staging spike: connect the CLI's
MCP server to the staging engine with a granted profile, trigger an
`ingest-document` run for a test office, inspect it, and replay it.
Agent surfaces in use: the REST API and the SDKs for our workers; the dashboard
and the CLI's MCP server for Claude Code.
Exceptions: line 2 (no read-only role found) and line 4 (no draft step), accepted
because agents operate this engine for us and hold no tenant content in it;
re-check with the spike.
