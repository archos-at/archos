# How much of Hatchet we use, November 2026

A sweep of the repository on 2026-11-11 for machinery of our own that does what
the workflow engine already does: sweeps that recover stuck records, leases,
claims, attempt counters, backoff ladders, polling loops and rows that mirror a
run. The engine decision is
[ADR-0150](../adr/0150-background-work-runs-on-self-hosted-hatchet.md); what a
record may become is declared separately
([ADR-0179](../adr/0179-lifecycles-are-declared-as-statechart-tables.md)).

## How it was made, and how far to trust it

Three readers: one read Hatchet's live documentation and both pinned SDKs, two
on the smallest model inventoried the TypeScript side and the Python side with a
file and line for every item.

**A row marked "read" was re-checked in the code by the author of this page. A
row not marked is a reader's report and may be wrong.** Of the first findings
re-read, two reported Python defects were deliberate choices with a side effect
(below), and one of three "routes nobody calls" has a caller. Treat every
unmarked item as a lead.

Not opened by any reader: the bodies of the purger's `purge-*.js`, the vector
reconcile, the source monitor, the project-intake slice, about ten browser
intervals, and on the Python side `claim_queue.py`'s SQL, the RIS adapter and
the public-source fetchers.

## What production runs (read)

The `prod` branch was last promoted on 2026-10-28
(`chore(release): promote develop 8cb6cf646 to prod`). The move to Hatchet
merged to `develop` on 2026-11-03. The production tree holds none of the Hatchet
code (`ingest_workflow.py`, `bff/jobs-queue/orchestrator.ts`,
`deploy/pulumi/src/platform/hatchet.ts` are absent) and still runs the claim
queues. This was read from the branch, not from the cluster.

Two consequences:

- Nothing on Hatchet has in-flight production runs. Its shape can change freely
  until the first promotion.
- The cutover code (`ingest_cutover.py`, the retired `ClaimQueue`, the
  re-dispatch in the [runbook](../deployment/hatchet.md#cutover-from-the-claim-queues))
  exists for that promotion. It is deleted after production has cut over and the
  old tables are empty, not before.

## What the engine offers and what we use

Versions: Python SDK 1.44.0, TypeScript SDK 1.46.0, engine v0.114.2 (the newest
in Hatchet's changelog on the day), chart `hatchet-ha` 0.21.0. Read from
`docs.hatchet.run` on 2026-11-11.

| Feature | Used |
|---|---|
| Retries, backoff, non-retryable, retry-after | yes |
| Schedule and execution timeouts | yes |
| Concurrency: round robin per organization, cancel in progress, cancel newest | yes |
| Priority, worker labels, additional metadata | yes |
| DAG with parents; on-failure task | Python only |
| Crons declared with the task; scheduled runs created and deleted | yes |
| Idempotency key on the trigger | yes |
| Scheduled runs updated in place, bulk update and delete | no |
| Durable tasks: sleep, wait for an event | no |
| Events: push, `on_events`, filters | no |
| Child runs, fan-out, bulk run | no |
| Dynamic rate limits per key | no |
| Bulk cancel and replay, listing runs through the API | no |
| DAG conditions (`skip_if`, `wait_for`) | no |
| OpenTelemetry | Python only |

Not offered: a webhook out of Hatchet when a run ends. The `settle` step's push
to `/api/internal/ingest/settled` is therefore the documented pattern and stays.

Cron time zones: the documentation says crons are UTC. The engine's source at
our tag parses crons with a library that understands a `CRON_TZ=` prefix. Not
settled until tested against a running engine; the result is recorded in
ADR-0150.

## The inventory in numbers

| | TypeScript | Python |
|---|---|---|
| Hatchet tasks | 13 cron sweeps, `fire-task-definition`, `bff-job` (26 kinds) | 3 workflows |
| Sweeps inside those crons | 22 (4 background work, 15 project mail, 3 upload) | 14 sweeps and polling loops |
| Other timers that sweep | purger (60 s), `bff-job` dispatch (60 s), 2 Kubernetes CronJobs | 4 housekeeping CronJobs, the Compose clock |
| Leases, claims, counters, backoffs | 20 | 15 |
| Detached work a crash loses | 16 sites | 8 |
| Rows that mirror a run | 12 | 10 status vocabularies |
| Waits on a person or on time | 18 | 13 |
| Browser polls | 9 read, about 10 more located | |

## What to do with it

The rule used to sort: a row the workspace reads stays ours, and a guarded
write stays, because delivery is at least once. What goes is whatever only
re-implements the engine: a second attempt counter, a second backoff, a queue
beside the queue, a clock beside the clock.

### Closed in the change that added this page

| What | Result |
|---|---|
| Inbox retention and the platform-lesson upkeep had no caller (the first never ran, production's old scheduler included) | two hourly crons, `collaboration-retention` and `platform-lessons-sweep`; both uncalled routes deleted |
| The Frist reminder ran hourly behind an office-clock gate | one cron, `CRON_TZ=Europe/Vienna 45 6 * * *`, proven against the engine at our tag; `office-clock.ts` deleted. The documentation still says UTC, so an engine spec in CI holds it |
| A fired scheduled run logged "could not delete" on every fire | a 404 on delete is done |
| Dead schema: `jobs`, `job_runs`, `tasks` | dropped in 0226 (0086 had copied every row and promised a drop that never came). The fourth dead table, `bff_job_lane_turns`, stays until production's cutover: see below |
| The purger repaired `pending` deletions with no attempts left | a CHECK forbids the state (0227); the repair is deleted |
| A new-version notice could be lost after its claim committed | the claim and the job row are one transaction |
| A received mail whose original could not be read was re-queued every dead-row retention, without end | the last attempt holds it, visibly |
| The folder-card build was claimed from our own table by a loop in every ingest pod, and a build over 900 s could run twice | three Hatchet tasks (`folder-cards-sweep`, `-build`, `-reconcile`); the table stays as the dirty set that debounces and orders children before parents. This one added code (about 70 lines net, after a deletion pass took back half of the first 140): what went is the defect and the per-pod polling. A run that died on every attempt was then retried every quiet period without end; its failure handler now counts such runs on the folder's row (`attempts`) and drops the mark at three, until the nightly reconcile |
| The browser polled every 4 to 5 s for an upload's reading, a filing suggestion, a mail import and a project's IFC model | each re-reads on a `shelf.changed` hint, with a 60 s fallback |

Examined and left, with the reason written where the code is: the job row's
`not_before` beside the engine's retry-after (ADR-0150), `scheduled.update` (it
moves the time and keeps the old input, so our fire would refuse itself;
ADR-0150), the backend housekeeping clocks (below).

### Worth doing, in this order

| # | What | Why | Removes |
|---|---|---|---|
| 1 | A research run's cancel is pushed, not polled (`CancellationMonitor` reads the database every second) | Hatchet cancels a run through the API and the task can read it | the poll, and a class of missed cancels |
| 2 | A job that waits re-triggers itself with `notBefore` (`document_check`, the agent wake behind another turn, the revision notice's delay) | a durable sleep or wait for an event is the engine's shape for this | the re-trigger bookkeeping per kind |
| 3 | `bff-job` gets an on-failure task that writes the owning record's failed state | three of the four background-work sweeps exist because a dead job leaves its record at `processing`/`queued` | most of `stuck-processing`, `filing-sweep` and the mail-import stale sweep, kept only as ratchets |

### Deliberately staying

| What | Why |
|---|---|
| `bff_job_queue` as a job's record | the workspace reads it (open job, dead job, last error); Hatchet's input holds ids only |
| The claim on a job's row, the compare-and-set writers | at-least-once delivery |
| The `settle` push and its read fallback | no outbound run-ended webhook |
| The Dragonfly vision slot pool | Hatchet limits a task run, not a call inside one |
| Project mail's retention sweeps (expiry, keep, restore window) | one bounded SQL statement a minute is simpler and survives an engine outage; thirty-day timers per mail in the engine would be state in two places |
| The purger | a separate process with the one role allowed to delete, and it must work when Hatchet does not |
| Task definitions as one scheduled run each plus `schedule-repair` | a missed cron tick is dropped, a missed scheduled run still fires |
| The proposal apply claim | a person's click, answered inline with a 409 |
| The Kubernetes CronJobs for the backend's housekeeping and the Compose `housekeeping-clock.js` | examined and left. Compose starts Hatchet only with its `hatchet` profile and the Coolify file has no Hatchet at all, so the clock script, its routes and their token stay whatever Kubernetes does; only about fifteen lines of manifest would go. No Python worker can own a cron on dev: both pools scale to zero and count only their own workflow's backlog, and their one to three slots are held by real work for up to forty minutes. The ghost-job reaper must not depend on the engine it cleans up after: with Hatchet down, the engine's own reassignment and the `runs-reconcile` cron are down too |
| The job row's `not_before` beside Hatchet's retry-after | one wait held twice, and the row's copy has three readers that cannot ask the engine (ADR-0150, "The row and the run after a failed attempt") |

Also open: chat attachments, the project intake and the count of waiting
project mail still poll, because no browser channel carries a project's (rather
than a shelf's) changes; a `project:<id>` channel is a new authorization
decision.

`folder_card_queue.claimed_at` is a dead column on every table made before this
change; nothing creates, writes or reads it now. It is not dropped yet: the
agent tier creates and alters that table at first use, so a drop would run in
the first new pod of a rollout while production's old pods still claim through
the column. Trigger: the release after the one that removes the claim loop is
on production ([runbook](../deployment/hatchet.md#folder-cards-need-no-re-dispatch)).
`.attempts` is in use again, as the bound below.

The folder-card tasks are durable tasks although nothing in them waits durably,
which the feature table above counts as "no". Examined and left: durable slots
are the only second slot pool a worker of the Python SDK at 1.44.0 has, and a
build must not share a pod's two or three document slots (evidence in the
header of `folder_cards/workflow.py` and in the runbook, "Folder cards on the
ingest worker").

### After production's cutover

Delete `ingest_cutover.py`, the retired `ClaimQueue` (about 900 lines), the
cutover loop in `ingest_worker.py`, and the old tables with a drop migration.
Trigger: the runbook's table counts read zero on production.

`bff_job_lane_turns` goes in that same drop migration, and not before. It has no
reader on this tree since ADR-0150, but production's running release claims
through it: the claim SQL in its `workers/job-queue.js` joins the table and
upserts into it on every claim. A migration is applied before the new pods are
ready and stays applied through a rollback
([rollback.md](../deployment/rollback.md)), so a drop any earlier breaks
production's old pods during the rollout of its first Hatchet release, and a
rollback to the release before it. 0226 first dropped it with the other three
and CI's migration contract check (`ci/migration_contract.py`) stopped that.
With the table go its Drizzle declaration (`bff/db/schema/bff-job-queue.ts`)
and the `DELETE` in `eraseLane` (`workers/job-queue.js`).

## Reported defects

Read and not a defect:

- `ingest_cutover._sealed` leaves a plaintext row claimed. Deliberate (its
  docstring: "for an operator to settle"). Side effect: `live_rows` keeps
  counting it, so the worker's hourly quiet exit never happens and it checks
  every minute.
- `CancellationMonitor._poll_job_status` logs and retries a failed read.
  Deliberate; a cancel is missed only if the database stays unreadable for the
  rest of the run.
- `/api/internal/upload-batches/sweep` has no scheduled caller because the
  `upload-sweep` cron calls the function directly; the route stays for the
  operator's catch-up (the stuck-documents runbook).

Read, and open:

- `deploy/compose/docker-compose.coolify.yaml` does not mention Hatchet, while
  its `bff-jobs` service and the ingest path run on Hatchet since ADR-0150
  (`docs/deployment/coolify.md` describes `bff-jobs` that way). A Coolify
  deployment of the current tree has no engine for its background work. Whether
  Coolify is still a supported target is the owner's call: either the file gains
  the engine or the target is retired.

Reported, not yet read (leads):

- The vision slot lease (210 s) can be outlived by a retried call (180 s
  timeout, one retry).
- A duplicate research run gives up after 360 s and reports success; if the
  live copy then dies, nothing retries it.
- The ingest hold is written once and fails open.
- `orchestrator_client` runs REST calls on four threads and a timed-out call
  keeps its thread.
- A settle announcement (`announceSettledVersions`) runs detached after a
  once-only settle, so a crash loses the notice.
- The social hand-off (`apps/cms`, `social:handoff`) is never scheduled.
