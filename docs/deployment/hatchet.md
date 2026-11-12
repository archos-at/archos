# Hatchet runbook

Every background job of the workspace runs on Hatchet (ADR-0150): ingesting a
document (`ingest-document`, and `ingest-document-heavy` for a large file), a
research run (`research-run`) and the BFF's jobs (`bff-job`, one task with the
job kind in its input). The claim queues it
replaced for ingest and research (`ingest_job_queue`, `research_job_queue`) are no
longer written; their tables stay until a later migration drops them.
`bff_job_queue` is still written: its row is each BFF job's record (payload,
attempts, holder), which the `bff-job` run reads and settles
(`apps/workspace/bff/jobs-queue/repository.ts`).

This page is for the operator: what runs where, how a stack gets it, how to
upgrade it, how to reach the dashboard, what to watch, and the cutover from
the claim queues.

## What runs where

Everything is in the `background-work` namespace, created by
`deploy/pulumi/src/platform/hatchet.ts`, on every Kubernetes stack. There is no
switch: Hatchet is required.

| Piece | What it is | Source |
|---|---|---|
| `hatchet-api`, `hatchet-grpc`, `controllers`, `scheduler` | The `hatchet-ha` chart's backend (each name is also its container port name, at most 15 characters), two replicas each, a PDB (`maxUnavailable: 1`) and preferred anti-affinity per component | `platform/hatchet.ts`, `hatchetValues` |
| `hatchet-frontend`, `caddy` | The dashboard and the chart's Caddy in front of it (`/api/*` to the API). ClusterIP, no route | same |
| `background-work-pg` | CloudNativePG cluster, two instances, database and role `hatchet` | `data/background-work-pg.ts` |
| `hatchet-rabbitmq` | `RabbitmqCluster`, three nodes, a PDB, a volume each; Hatchet's message queue | `platform/rabbitmq.ts` |
| RabbitMQ Cluster Operator | In `rabbitmq-system`, from its pinned release manifest | `platform/rabbitmq.ts` |
| `hatchet-token-sync` | Job that copies the worker token into the app namespace | `platform/hatchet.ts` |
| `background-work-pg-grants` | Job that gives KEDA's read-only login the columns it counts, and sets the `hatchet` role's statement timeout | `data/background-work-pg.ts` |
| `background-work-alert-rules` | Prometheus rules (ConfigMap) | `platform/background-work-alerts.ts` |

Why its own namespace: the chart's setup and worker-token Jobs add the
`SYS_PTRACE` capability, which the app namespace's `baseline` Pod Security
Standard rejects, and the chart's Role lets the API's ServiceAccount read and
write every Secret in its namespace. The namespace enforces `privileged` and
warns and audits on `baseline`.

The app tiers that start or run Hatchet runs (chat, api, agent-worker,
ingest-worker, ingest-worker-heavy, frontend, bff-jobs) get the SDK's environment
(`HATCHET_CLIENT_TOKEN`, `HATCHET_CLIENT_HOST_PORT`, the REST API's URL as
both `HATCHET_CLIENT_SERVER_URL` (Python) and `HATCHET_CLIENT_API_URL`
(TypeScript), `HATCHET_CLIENT_TLS_STRATEGY=none`,
`HATCHET_CLIENT_NAMESPACE`=the stack name;
[`environment-variables.md`](environment-variables.md), "Hatchet client").
Only they reach the gRPC engine (7070) and the API (8080); only Hatchet's four
backend components reach RabbitMQ (5672); KEDA's operator reaches
`background-work-pg` (5432). `hatchet-network-policies.ts` holds the rules.

KEDA scales `ingest-worker`, `ingest-worker-heavy`, `agent-worker` and
`bff-jobs` on their workflow's backlog: the runs in `v1_queue_item` (waiting for a slot) plus those in
`v1_task_runtime` (held by a worker), matched on the action prefix
`<namespace>_<workflow>:` (`hatchetBacklogQuery`, `app/keda-scaling.ts`). A run
held back by its organisation's concurrency limit is in neither table, so it
asks for no replica it could not use. The prefix ends in the colon, so
`ingest-worker`'s `<namespace>_ingest-document:` never counts a run of
`ingest-document-heavy`.

## Ingestion on two pools

| | `ingest-worker` | `ingest-worker-heavy` |
|---|---|---|
| Workflow | `ingest-document` | `ingest-document-heavy` (same steps) |
| Takes | every file below `INGEST_HEAVY_FILE_BYTES` (40 MiB), and every file whose size the BFF did not state | a file of 40 MiB or more (`byte_size` on `/v1/ingest`) |
| Worker | label `pool=standard`, `ingestWorkerConcurrency` slots | label `pool=highmem`, `INGEST_WORKER_POOL=highmem`; its `index` requires the label and costs the pod's slots (`slot_cost`), so a pod runs one heavy file |
| Size (defaults) | 6Gi, 2 or 3 files a pod | 12Gi, one file, 0 to 1 pods (`ingestWorkerHeavy*`) |

A trigger of a workflow no worker has registered yet gets a run id and creates
nothing, so `trigger` asks the engine (`workflows.list`) once per process and
refuses until the workflow exists; `ingest_dispatch` then runs the job in the
API pod, as it does when Hatchet is away. Deploy the ingest workers with or
before the API pods on a fresh platform.

Both workflows share two **tenant-scoped** concurrency limits, which span
task definitions: `ingest-org` (`GROUP_ROUND_ROBIN` on the organisation,
`INGEST_MAX_PER_ORG`), so an office's heavy and standard files count against
one fairness budget, and `ingest-supersede` (`CANCEL_IN_PROGRESS`, one run per
document), so a re-upload cancels the run still reading the old bytes. Both sit
on the `index` task, not the workflow: the engine refuses a tenant-scoped limit
on a workflow of more than one task. That
run writes its status `cancelled` with `metadata.superseded`, never as a
person's cancel, and sends no settle push; a person's cancel marks the run id
first (`ingest_run_hold.mark_stopped_by_person`) so the run can tell the two
apart. A person's cancel also settles the status row `cancelled` and releases
its hold (`held_until`); a run told to stop, for any of the three reasons,
writes no live or failed status again and may only still write `completed`
([Stopping a read](../technical-reference/document-ingestion.md#stopping-a-read-cancel)). Named tenant-scoped limits need engine ≥ 0.106.0; on our v0.114.2 they
are exercised only by the CI engine job.

Both pools count against the vision pool and Postgres's session locks
(`ingestJobsAtCeiling`, `assertVlmPeakFitsCeiling`, `assertPgConnectionBudget`).
Prod runs 7 standard pods and one heavy one for that reason. A stack without the
heavy pool (`ingestWorkerHeavyEnabled: false`, and Compose) sets
`INGEST_HEAVY_FILE_BYTES=0` on the dispatching tiers, so no file waits for a
worker that does not exist. A heavy run that waits past `SCHEDULE_TIMEOUT` (24 h)
is given up like any other.

**Credits in flight.** When `index` fails with the provider's 402 for credits
that requests in flight hold, the attempt pauses the rate-limit key
`<namespace>ingest-provider-credits` for 30 s (`ctx.pause_rate_limit`; every
`index` consumes the key, so new starts wait) and raises
`RetryAfterException` for 60 s. Each wait spends one of the step's retries, so
`index` has 12: two for ordinary failures, which are final after their third
attempt however many remain, and ten for credit waits. The worker creates the
key at start (`rate_limits.put`, a limit that holds nothing back). `RetryAfter`
needs engine ≥ 0.111.0; the pause RPC is unverified on v0.114.2 until the CI
engine job meets one.

**Traces.** `ingest-worker`, `ingest-worker-heavy` and `agent-worker` install
the SDK's `HatchetInstrumentor` on the provider Langfuse reads
(`observability/orchestrator_tracing.py`), with `enable_hatchet_otel_collector=False`
so no span lands in Hatchet's database, and `payload` and
`additional_metadata` excluded from every span. A trigger opens an
`ingest-trigger` span and puts its `traceparent` in the run's metadata; the
step run (`hatchet.start_step_run`) and every file's `ingest-file` trace
continue it, so the queue wait is the gap between the trigger and the step run
in one trace.

### Two URLs for the API

The chart's `sharedConfig.serverUrl` stays `http://localhost:8080`: it is the
dashboard's own address behind the port-forward (its links, its cookie domain).
The engine also stamps it into every token as the `server_url` claim, and both
SDKs fall back to that claim when no API URL is set. Inside a pod, localhost is
the pod itself, so a client on the claim fails every REST call: scheduled runs,
crons, cancels, pausing a workflow. That is why every tier is given
`http://hatchet-api.background-work.svc.cluster.local:8080` (the chart's
`hatchet-api` Service) explicitly, under both SDKs' names
(`HATCHET_API_URL`, `platform/hatchet.ts`), and the token's claim is never
used. Exposing the dashboard on a real hostname would mean changing
`serverUrl` and the cookie domain together; the clients would not notice.

## Crons and scheduled runs: what the engine does

Found by trial on `hatchet-lite` v0.114.2 with TypeScript SDK 1.46.0
(2026-11-11; ADR-0150 has the note):

* **A cron is UTC unless it names a zone.** An expression that starts with
  `CRON_TZ=<IANA zone> ` runs on that zone's clock (tried for Vienna and Tokyo
  on one November day; the summer offset was not tried):
  `frist-reminder` is `CRON_TZ=Europe/Vienna 45 6 * * *`. The crons API and
  the dashboard show the expression as written and no next start time.
* **A cron tick that comes due while the task's previous run is still going
  is dropped** (`CANCEL_NEWEST`), and one the engine was down for is not
  caught up as far as we know (not tried). Work that must not skip an
  occurrence is a scheduled run, as a task definition is.
* **A scheduled run that fired is gone from the API**: get, update and delete
  answer 404. `scheduled.update` moves a pending run's `triggerAt` and keeps
  its input, so it cannot stand in for delete and create where the input
  carries the due time (`bff/scheduling/scheduled-runs.ts`).
* **Every maintenance sweep is a cron task of the `bff-jobs` worker**
  (`SWEEPS`, `apps/workspace/bff/scheduling/tasks.ts`; the table is in
  [`agent-skills.md`](../architecture/agent-skills.md#scheduler-worker-hatchet-appsworkspacebffscheduling)).
  A sweep that exists only as a function or an internal route has no caller:
  the inbox retention ran nowhere, on the old scheduler or since, until it
  became `collaboration-retention`.

## Folder cards on the ingest worker

The folder card builder (ADR-0127, tier 1) has no Deployment and no scaler of
its own. The standard `ingest-worker` serves its three workflows beside
`ingest-document` (`packages/agent/src/agent/knowledge/folder_cards/workflow.py`),
because a build needs the summary model and the embedder that worker holds:

| Workflow | When | What it does |
|---|---|---|
| `folder-cards-sweep` | cron, every minute | asks the dirty set (`folder_card_queue`) which collections hold a folder that went quiet and starts one build for each |
| `folder-cards-build` | started by the sweep | builds one collection's due folders, children before parents; its failure handler is `give-up` |
| `folder-cards-reconcile` | cron, 02:23 UTC | marks every folder whose card no longer matches its inputs |

What the engine does, and what stayed ours:

* **Ours: the dirty set.** `folder_card_queue` in the agent database (the one
  `document_metadata` is in) is one row per dirty folder with two clocks: a
  folder is due once nothing marked it for ten minutes, or once it has been
  dirty an hour. A parent waits for every dirty folder below it. Hatchet has no
  debounce and must never hold a folder path (a person's words), so the set
  stays, and the sweep reads it. A run carries the collection and the
  organisation, nothing else.
* **The engine's: who builds, and how often.** One live `folder-cards-build`
  run per collection (idempotency on `input.collection`; the sweep's next
  minute collides and starts nothing; a run waiting out its backoff is still
  that one run, which `test_folder_card_workflow_engine.py` holds on a real
  engine), one collection at a time per
  organisation (`folder-cards-org`, round robin), three attempts 25 s and ten
  minutes apart, 30 minutes per attempt. A failed folder fails the attempt
  after the other folders were built; the last attempt gives it up (out of the
  set, its card `failed`), and the nightly reconcile marks it again.
* **Ours: the bound on a build that cannot pass.** A run that dies on every
  attempt (its worker lost, every attempt timed out) settles no folder, so its
  failure handler `give-up` counts the run on each dirty folder of the
  collection (`folder_card_queue.attempts`) and starts their clocks again. A
  folder that has counted three such runs (`queue.GIVE_UP_ROUNDS`) leaves the
  set, with a warning `N folder(s) of <collection> left the dirty set`, and the
  nightly reconcile marks it again if its card is still stale: at most three
  runs a day, where it used to be one every quiet period without end. A build
  that passes, or a row that goes, ends the count.
* **Slots.** The three tasks are durable tasks for one reason: the durable
  slots are the only second pool a worker of hatchet-sdk 1.44.0 has. Each
  standard ingest pod offers two (`WORKER_SLOTS`), so a build, which waits on a
  model for up to half an hour, neither takes one of the pod's two or three
  document slots nor waits behind ingestion
  (`test_a_build_neither_waits_for_the_document_slot_nor_takes_it`, on a real
  engine). The heavy pool serves none of them. What was tried instead, read in
  the SDK and run on engine v0.114.2 on 2026-11-11: a worker has the pools
  `default` and `durable` and no public way to name a third (`slot_cost`
  charges `default`); a second `hatchet.worker(...)` in the process serves, but
  only the worker built last gets SIGTERM, the other took a new run after it
  and the process never exited, and its tasks run on another event loop than
  the lifespan that built the summary model; a worker label routes a run to a
  worker and reserves nothing inside one. File and line for each are in the
  header of `folder_cards/workflow.py`. Sharing the standard slots was
  rejected on the numbers: one build per organisation, so two organisations'
  builds would hold every upload of a two-slot pod for up to half an hour.
* **Scaling.** KEDA counts `ingest-document` only. Every stack keeps at
  least one ingest pod (`ingestWorkerMinReplicas` ≥ 1, held by
  `ingest-worker.spec.ts`): at zero no worker registers the workflow, the base
  corpus's jobs are refused before they reach the backlog, and nothing ever
  scales the tier up (the AT publish on dev, 2026-11-12). The card builder
  runs while that pod is up.

To see what waits: `SELECT collection, count(*), min(dirty_since) FROM
folder_card_queue GROUP BY 1` in the agent database, and the runs of
`folder-cards-build` in the dashboard. To build one collection now, trigger
`folder-cards-build` there with `{"collection": …, "organization_id": …}`.

## Enabling a stack (dev first)

Nothing to set: the next `pulumi up` of a stack builds the platform. Every
credential defaults to a one-way HMAC of `pgAppPassword`, so no new secret is
needed. To rotate one on its own, set it in the stack's ESC environment:
`backgroundWorkPgPassword`, `backgroundWorkPgScalerPassword`,
`hatchetAdminPassword` (`deploy/pulumi/README.md`, "Background work").

1. Preview on dev: `cd deploy/pulumi && npm run preview -- --stack dev`. Expect
   the `background-work` namespace, the cluster, the RabbitMQ operator and
   cluster, the `hatchet` release, the two Jobs, the policies, and an env
   change on the six tiers above.
2. Deploy dev (the normal pipeline). The `hatchet` release waits for its Jobs
   (`waitForJobs`): the setup Job runs the migrations and seeds the admin, the
   worker-token Job writes the token. `hatchet-token-sync` copies it, then the
   tiers roll.
3. Check: `kubectl -n background-work get pods`, all `Running`;
   `kubectl -n grid get secret hatchet-client-token -o jsonpath='{.data.HATCHET_CLIENT_TOKEN}' | wc -c`
   is not 0; the dashboard (below) shows the workers under Workers.
4. Do the cutover (below) on dev, then promote to prod.

## How the token is made

The chart's worker-token Job runs `hatchet-admin k8s create-worker-token` on
every install and upgrade. It mints a tenant token for the default tenant (100
years) and writes it to the Secret `hatchet-client-config`, key
`HATCHET_CLIENT_TOKEN`, in `background-work`. A pod cannot read another
namespace's Secret, so `hatchet-token-sync` (a ServiceAccount that may `get`
exactly that Secret and `patch` exactly `hatchet-client-token` in the app
namespace) copies the key across. Pulumi creates `hatchet-client-token` empty
and ignores its data.

A new token does not invalidate the old one, so a tier that started with the
previous token keeps working. The copy re-runs whenever the chart version or
the image tag moves. A leaked token is revoked in the dashboard (Settings, API
Tokens); the next upgrade of the release mints a fresh one, and the tiers pick
it up when they restart (`kubectl -n grid rollout restart deploy/<tier>`).

## Upgrading

Both versions are pinned, and move together: `hatchetChartVersion` (the
`hatchet-ha` chart, default `0.21.0`) and `hatchetImageTag` (every component,
through the chart's `sharedConfig.image.tag`, default `v0.114.2`; Compose's
`hatchet-lite` carries the same tag).

1. Read Hatchet's release notes for every version in between, and its
   "Upgrading and Downgrading" page. A downgrade of the database schema is a
   manual step there.
2. Raise both on dev: `pulumi config set hatchetChartVersion <v> --stack dev`,
   `pulumi config set hatchetImageTag <tag> --stack dev`, and the Compose pin.
3. `npm run preview -- --stack dev` shows a `helm upgrade` of the release. On
   upgrade the chart runs its migration Job as a `pre-upgrade` hook; a failed
   one is kept (`retainFailedHooks`) so its log survives:
   `kubectl -n background-work logs job/hatchet-api-migration`.
4. The `hatchet` role has `statement_timeout = 5min`. A migration that needs
   longer fails on it: run `ALTER ROLE hatchet SET statement_timeout = 0` as
   the owner for the upgrade, and the next deploy's grants Job puts it back.
5. Watch dev for a day (below), then prod.

### RabbitMQ

The operator is pinned by `RABBITMQ_OPERATOR_VERSION` (`platform/rabbitmq.ts`,
2.23.2); `scripts/validate-crs.mjs` validates the `RabbitmqCluster` against the
CRD of that same release. To upgrade it, read the operator's release notes,
raise the constant, preview on dev. An operator upgrade can roll every
RabbitmqCluster it manages (a new default RabbitMQ image); the PDB keeps that to
one node at a time, and two of three keep the quorum.

The RabbitMQ version is pinned by `RABBITMQ_IMAGE` (`rabbitmq:4.2.9-management`,
by digest): the minor Hatchet's own `docker-compose.yml` names at
`HATCHET_IMAGE_TAG` (4.2.8 at v0.114.2), at its latest patch, never the
operator's default. Hatchet declares classic queues with a hardcoded
`x-consumer-timeout`, which RabbitMQ 4.3 accepts only on quorum queues, so on
4.3 every Hatchet component exits at boot with `406 PRECONDITION_FAILED -
invalid arg 'x-consumer-timeout'`. When you raise `HATCHET_IMAGE_TAG`, read that
tag's `docker-compose.yml` and move `RABBITMQ_IMAGE` to its RabbitMQ minor. RabbitMQ
does not downgrade: a node refuses data written by a newer minor, so lowering the
image on a running cluster means new volumes.

Before any RabbitMQ change, check the cluster is whole:

```bash
kubectl -n background-work get rabbitmqcluster hatchet-rabbitmq
kubectl -n background-work exec hatchet-rabbitmq-server-0 -- rabbitmq-diagnostics cluster_status
kubectl -n background-work exec hatchet-rabbitmq-server-0 -- rabbitmqctl list_queues name messages_ready consumers
```

Hatchet's components read the AMQP URL from the operator's generated
`hatchet-rabbitmq-default-user` Secret (`username`, `password`), which the
kubelet expands into `SERVER_MSGQUEUE_RABBITMQ_URL`. If the engine logs an AMQP
URL parse error, check the generated password for characters a URL cannot
carry: `kubectl -n background-work get secret hatchet-rabbitmq-default-user -o jsonpath='{.data.password}' | base64 -d`.

## Reaching the dashboard

There is no route, and the gRPC and API ports admit only the app tiers. Port-forward
to Caddy, which goes through the API server, which NetworkPolicy does not see:

```bash
kubectl -n background-work port-forward svc/caddy 8080:8080
# then http://localhost:8080
```

Sign in as `hatchetAdminEmail` (default: the stack's `letsEncryptEmail`) with
the admin password:

```bash
kubectl -n background-work get secret hatchet-shared-config -o jsonpath='{.data.ADMIN_PASSWORD}' | base64 -d
```

Signup is off (`SERVER_ALLOW_SIGNUP=false`).

## What to watch

The engine's components serve Prometheus metrics on 9090 and RabbitMQ on 15692;
the node agents scrape both (ADR-0119), and `background-work-alert-rules` holds
the rules for whichever evaluator reads them:

| Signal | Where | Rule |
|---|---|---|
| Backlog | `hatchet_tenant_queue_size`, and the KEDA trigger's value (`keda_scaler_metrics_value` on the KEDA operator) | — |
| Backlog age: queued to assigned | `hatchet_queued_to_assigned_time_seconds` (histogram) | `HatchetSchedulingLag`: p95 over 300 s for 15 min |
| Scheduler lag | `hatchet_queue_invocations_total` rate, `hatchet_scheduling_timed_out` | — |
| RabbitMQ queue depth | `rabbitmq_queue_messages_ready` | `RabbitmqQueueDepth`: over 1000 for 15 min |
| A RabbitMQ node down | `kube_statefulset_status_replicas_ready` of `hatchet-rabbitmq-server` | `RabbitmqNodeUnavailable`: below 3 for 5 min |
| Postgres CPU and connections | the instances' exporter (9187); `kubectl cnpg status background-work-pg -n background-work` | — |

By hand, the backlog per workflow is the KEDA query itself:

```bash
kubectl cnpg psql background-work-pg -n background-work -- -d hatchet -c \
  "SELECT split_part(action_id, ':', 1) AS workflow, count(*) FROM v1_queue_item GROUP BY 1"
```

## Cutover from the claim queues

A running deployment may hold queued rows in the old tables when the release
that moves to Hatchet lands. Nothing claims them afterwards.

1. **Apply the platform.** Deploy the release to the stack (dev first). The
   platform comes up before any tier rolls: every tier that starts or runs a
   run waits for `hatchet-token-sync`.
2. **Deploy.** The tiers roll onto Hatchet; the worker tiers scale on its backlog.
3. **Run the re-dispatch.** It re-submits what the old tables still hold to
   Hatchet. For ingest that is the BFF's re-dispatch of `pending` documents; the
   release notes of the change name the exact command for each queue.
4. **Watch the old tables empty.** On the app cluster:

   ```bash
   kubectl cnpg psql grid-pg -n grid -- -d jobs -c \
     "SELECT 'ingest' q, status, count(*) FROM ingest_job_queue GROUP BY 2 UNION ALL
      SELECT 'research', status, count(*) FROM research_job_queue GROUP BY 2"
   kubectl cnpg psql grid-pg -n grid -- -d app -c "SELECT status, count(*) FROM bff_job_queue GROUP BY 1"
   ```

   Rows that are `queued` or `claimed` and are not moving after the re-dispatch
   are the ones to look at; `dead` rows are traces and stay until the drop
   migration.

There is no way back to the claim queues on the same release: rolling back is
deploying the previous release, whose tiers still claim from the old tables.
Runs already started in Hatchet then finish only once a release that runs on
Hatchet is back.

### Folder cards need no re-dispatch

Until this release the builder claimed rows of `folder_card_queue` itself
(`claimed_at`, a reclaim after 900 s, `attempts`). The table is the same table
and its rows mean what they meant, so whatever a stack holds at the deploy
(production moves to Hatchet and to this in one step) is found by the first
`folder-cards-sweep`: nothing to move, no command to run. A card is derived and
can always be rebuilt; a row lost anywhere is marked again by the nightly
reconcile.

While the rollout lasts, an ingest pod of the release before still runs its
loop and may claim a folder a Hatchet run is building too. Both write the same
card through the same idempotent `PUT`; the cost is one model call, and it ends
with the last old pod. A rollback needs nothing either: the old code reads the
columns it left.

`attempts` has a use again: the count of runs that failed for good over a dirty
folder (above). It is `NOT NULL` with no database default, so `queue.mark`
writes its zero. An old pod still raises it on each claim and gives a folder up
at three, so while a rollout lasts a folder can leave the set a run early; the
reconcile marks it again.

`claimed_at` is dead and deliberately still there. Nothing on this release
creates, writes or reads it, so a table made from now on lacks it. A table made
before has it, and it is **not** dropped yet: no migration owns the table, the
agent tier creates it at first use (`folder_cards/queue.py`, `ensure_schema`),
in the agent database, not the BFF's, so a drop there would run in the first
new pod of the rollout while every old pod's claim still reads the column, and
a rollback would land on a table its claim cannot read. The trigger for the
drop: the release after the one that removes the claim loop is on production.
Then add `ALTER TABLE folder_card_queue DROP COLUMN claimed_at` to
`_create_tables`, behind a check that the column exists (SQLite has no `IF
EXISTS` for a column; `db_utils` has the column check the sibling stores use
before an `ADD COLUMN`).

## Compose

`deploy/compose/docker-compose.yaml` has a `hatchet` profile: `hatchet-lite`
(the engine, API and dashboard in one container, at the same image tag) and its
Postgres. `docker compose --profile hatchet up -d`, then create a token at
http://localhost:8888 (Settings, API Tokens) and set the four `HATCHET_CLIENT_*`
lines of `deploy/.env.example` in `deploy/.env`. The API's URL needs no line:
the app services default `HATCHET_CLIENT_SERVER_URL` and
`HATCHET_CLIENT_API_URL` to `http://hatchet-lite:8888`, because the token's
`server_url` (the lite engine's `SERVER_URL`, `http://localhost:8888`, which
the browser needs) is the container itself from inside one.
