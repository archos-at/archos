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

### Costed and not done

Three further moves were costed from the code against one bar: less
production code and fewer mechanisms, with no behaviour lost. None clears it.

| Move | Why not |
|---|---|
| Push a research run's cancel instead of polling for it | It is already pushed: the cancel route writes the status and calls `research_workflow.cancel`, and the SDK cancels the task. `CancellationMonitor` stays because it also reads the reader's steering events (write now, a document added), which a running Hatchet task cannot receive, and because its status read covers the ghost-job reaper's verdict, a failed cancel call and a cancel that lands before the run id is stored. Net about zero lines |
| A durable sleep or wait for an event where a job re-triggers itself with `notBefore` | `notBefore` already is a Hatchet scheduled run with the row as its record. About 25 lines could go; a durable task would add a second declaration and slot pool, hold a per-office slot and the row for the whole wait, and `document_check` has no event to wait for, so it would still poll. Net 15 to 45 lines more, and two mechanisms where there is one |
| An on-failure task that writes the owning record's failed state | Only each sweep's "dead job" branch could go (about 29 lines); the "no job at all" case stays in every sweep and no failure handler sees it. A job goes `dead` in our own `failJob`, so no engine feature is needed either. The one real gain is latency (a dead job's document reads `processing` for fifteen minutes): a small feature of its own, not a reduction. It was then built for documents: the run that makes a job dead fails the documents naming it at once (`failDocumentsOfDeadJob` in `apps/workspace/bff/documents/stuck-processing.ts`, called by `buried` in `bff/jobs-queue/task-run.ts`), and every sweep keeps its dead-job branch |

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
| The Kubernetes CronJobs for the backend's housekeeping and the Compose `housekeeping-clock.js` | examined and left. Compose starts Hatchet only with its `hatchet` profile, so the clock script, its routes and their token stay whatever Kubernetes does; only about fifteen lines of manifest would go. No Python worker can own a cron on dev: both pools scale to zero and count only their own workflow's backlog, and their one to three slots are held by real work for up to forty minutes. The ghost-job reaper must not depend on the engine it cleans up after: with Hatchet down, the engine's own reassignment and the `runs-reconcile` cron are down too |
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
- A duplicate research run gives up after 360 s and its Hatchet run ends as
  done (`run_ownership.take_ownership`, `research_workflow.run_task`); if the
  live copy then dies, nothing retries and the ghost reaper fails the job.
  True, and left: failing the duplicate instead would spend the job's retries
  while the live run works, and the on-failure task
  (`worker.record_exhausted_verdict`) would then write FAILURE over a run that
  is alive. The job ends visibly failed, never silently. The reason is now in
  the module's docstring.
- `orchestrator_client` runs REST calls on four threads and a timed-out call
  keeps its thread. True, and no later call is delayed by it: the 15 s bound
  is on the caller's wait for the result (`within_rest_timeout`), queue time
  included, so with four threads hung a fifth caller gets `TimeoutError` after
  15 s, as it would from an engine that does not answer. Both callers have a
  fallback (the ingest runs in the accepting process, the cancel answers
  "unavailable"). The pool is what bounds the leaked threads. One side effect:
  a call that timed out while still queued runs once a thread frees, so a
  cancel reported as unavailable can still land two minutes later; the run was
  marked stopped by the person first, so it reads as their cancel.
- The writes after a chat turn's terminal (`after_terminal_writes.py`: the
  answer row, the answer into an Anmerkung's thread, a headless caller's
  outcome notice) are tasks in the process and a kill loses them. Deliberate,
  per the module's docstring: a drain waits 30 s for them, and the rest is
  bounded elsewhere. The browser writes the same answer row under the same
  deterministic id (`chat_socket.py`, header), and an ask whose notice never
  came is ended `failed` when next read, after the turn's deadline plus the
  notice's grace (`DEFAULT_ASK_MAX_SECONDS`, `ask-wire.ts`). Not derived again
  by anything: the thread's answer, and the answer row of a headless turn. Not
  read: whether a wake on a mark has a bound like the ask's.
- The social hand-off (`apps/cms`, `social:handoff`) is never scheduled. A
  recorded open decision, not an omission: it needs a Buffer account, its key
  and a schedule from the owner (`apps/cms/README.md`, "Social posts";
  ADR-0155).

Read and real, closed in the change that read them (each with a test that
failed first):

- The vision slot lease (210 s) was outlived by its call. The 180 s is httpx's
  timeout per phase of one attempt, the SDK makes two attempts with a backoff
  between, and each first queues for a provider slot inside our transport,
  under no timeout. When the lease aged out mid-call the pool counted one
  holder fewer and admitted one more; the late release removed nothing. The
  provider limiter (renewed leases, ceiling 32) still bounded what the provider
  saw, so the breach showed only with `VLM_FLEET_CONCURRENCY` set below it, and
  in the fair share between organisations. `lease_slots.hold` now renews its
  lease while the body runs.
- The ghost reaper and the research takeover used one window by comment and
  read different signs of life. The reaper read events only; a retry that took
  a dead run over touches `job_info.updated_at` and emits nothing until its
  workflow is built, so the next two-minute reaper cycle could fail the run
  just rescued. The reaper now reads both signs, as `run_ownership` does, and
  its window is `run_ownership.STALE_SECONDS` by import; a test holds the wait
  above the window.
- The ingest hold was one write that failed open. Lost, the row read
  `interrupted` two minutes after the job was accepted, the document showed as
  failed while its job waited, and a retry after a lost worker refused itself
  (`_settled_before`). The hold is now tried three times within a second. A
  database away for longer still loses it, and the dispatch is not failed for
  that: the run has started by then.
- A document failed as `interrupted:` whose job finished later than the
  30-minute re-check window (`lost-job.ts`) stayed failed although it was read:
  the settle push looked for in-flight rows only. The push now finds such a row
  too and re-reads its job with no window. A push that is lost leaves the old
  behaviour; „Erneut lesen" finds the job done.

Read, real, and open:

- `onDocumentsSettled` (`upload-batches/settle.ts`) runs
  `announceSettledVersions` detached after the once-only settle. A process that
  ends in those seconds (a deploy as much as a crash) loses, for good, the "new
  Fassung" inbox items and the document check of that upload; the claim in
  `document_revision_announcements` only stops a second telling. The pattern
  that closed the revision notice (the job row in the claim's transaction)
  applies one level up: a job row written in the transaction of the guarded
  status write (`setDocumentReconciledStatus`), whose run announces. That is a
  new `bff-job` kind with its payload schema, handler and registry entries,
  and a change to the one write every reconcile path shares, so it was not
  folded into a reading pass.
- Closed: `deploy/compose/docker-compose.coolify.yaml` had no Hatchet engine
  while `bff-jobs` and the ingest path run on Hatchet since ADR-0150. Coolify
  was retired as a deployment target on the owner's decision (2026-11-11); the
  file, its page and the specs that parsed it are deleted.

Reported, not yet read (leads): none. The six leads listed here, and two more
from the same readers (the writes after a chat turn's terminal, the 30-minute
re-check of an interrupted read), were read on 2026-11-11 and sorted above.
