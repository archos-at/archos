# Hatchet runbook

Every background job of the workspace runs on Hatchet (ADR-0150): ingesting a
document (`ingest-document`, and `ingest-document-heavy` for a large file), a
research run (`research-run`) and the BFF's jobs (`bff-job`, one task with the
job kind in its input). The claim queues it
replaced (`ingest_job_queue`, `research_job_queue`, `bff_job_queue`) are no
longer written; their tables stay until a later migration drops them.

This page is for the operator: what runs where, how a stack gets it, how to
upgrade it, how to reach the dashboard, what to watch, and the cutover from
the claim queues.

## What runs where

Everything is in the `background-work` namespace, created by
`deploy/pulumi/src/platform/hatchet.ts`, on every Kubernetes stack. There is no
switch: Hatchet is required.

| Piece | What it is | Source |
|---|---|---|
| `hatchet-api`, `hatchet-grpc`, `hatchet-controllers`, `hatchet-scheduler` | The `hatchet-ha` chart's backend, two replicas each, a PDB (`maxUnavailable: 1`) and preferred anti-affinity per component | `platform/hatchet.ts`, `hatchetValues` |
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
apart. Named tenant-scoped limits need engine ≥ 0.106.0; on our v0.114.2 they
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
(`observability/hatchet_tracing.py`), with `enable_hatchet_otel_collector=False`
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
one node at a time, and two of three keep the quorum. The RabbitMQ version
itself is the operator's default image for that release; pin `spec.image` in
`rabbitmqClusterSpec` if a stack must hold one.

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
