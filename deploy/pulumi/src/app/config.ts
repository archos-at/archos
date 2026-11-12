import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { APP_DEFAULTS, LANGFUSE, PORT, QDRANT } from "../constants";
import { APP_DB, CHECKPOINTS_DB, JOBS_DB, RUNTIME_ROLE, type Postgres } from "../data/postgres";
import { FRONTEND_DRAIN_SECONDS, secretChecksum } from "../platform/rollout";
import { frontendLangfuseEnv, LANGFUSE_SECRETS_NAME, LANGFUSE_SECRET_KEYS } from "../platform/langfuse";
import { logicalName, objectName } from "../names";
import { inboundMailAppEnv } from "../config/inbound-mail";
import { API_TIER, CHAT_TIER } from "./tier-names";
import { posthogEnv } from "./posthog-env";
import { hatchetEnv } from "./hatchet-env";
import { publicSourceFetcherEnv } from "./public-source-fetcher";
import { openrouterKeyEnv, openrouterSecretValues } from "./model-keys";
import type { ModelWorkload } from "../config/app-services";
import { heavyFileBytesEnv } from "../config/workers";

/** The BFF's `service.name`; the collector routes its spans by it (`APP_TRACE_SERVICES`). */
export const BFF_SERVICE_NAME = "grid-ui";
type EnvVar = k8s.types.input.core.v1.EnvVar;

export interface AppWiring {
  cfg: DeployConfig;
  namespace: pulumi.Input<string>;
  provider: k8s.Provider;
  redisUrl: pulumi.Output<string>;
  seaweedInternalEndpoint: pulumi.Output<string>;
  seaweedPublicEndpoint: pulumi.Output<string>;
  /** Office → PDF converter URL (set when cfg.gotenberg.enabled, ADR-0070). */
  gotenbergUrl?: pulumi.Output<string>;
  /** clamd's `tcp://` URL (set when cfg.malwareScan.enabled, ADR-0157). */
  malwareScanUrl?: pulumi.Output<string>;
  /** The Qdrant cluster's client URL (ADR-0115): the one vector store, so there is no embedded one. */
  qdrantUrl: pulumi.Output<string>;
  /** Every DSN states its route (`via`), pooled or direct: see `PgRoute` in `data/postgres.ts`. */
  dsn: Postgres["dsn"];
  /**
   * imagePullSecrets for every app pod spec — references the registry pull
   * Secret when the app images are private, empty when they are public.
   */
  imagePullSecrets: { name: string }[];
}

export const SECRET_NAME = objectName("appSecret"); // pragma: allowlist secret (Kubernetes Secret resource name, not a credential)
export const PULL_SECRET_NAME = objectName("registryPullSecret"); // pragma: allowlist secret (Kubernetes Secret resource name, not a credential)

/**
 * dockerconfigjson pull Secret for a namespace (the app's; the CMS's own copy is
 * `resourceName` "cms-registry-pull"), created only when registry credentials are
 * configured (private images); pod specs reference it via imagePullSecrets.
 */
export function buildRegistryPullSecret(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  resourceName = logicalName("grid-registry-pull"), dependsOn: pulumi.Resource[] = [],
): k8s.core.v1.Secret | undefined {
  const creds = cfg.images.pullCredentials;
  if (!creds) return undefined;
  // Registry server = first path segment of the image registry
  // ("ghcr.io/archos-at" → "ghcr.io").
  const server = cfg.images.registry.split("/")[0];
  const dockerConfigJson = creds.password.apply((pw) =>
    JSON.stringify({
      auths: {
        [server]: {
          username: creds.username,
          password: pw,
          auth: Buffer.from(`${creds.username}:${pw}`).toString("base64"),
        },
      },
    }),
  );
  return new k8s.core.v1.Secret(
    resourceName,
    {
      metadata: { name: PULL_SECRET_NAME, namespace },
      type: "kubernetes.io/dockerconfigjson",
      stringData: { ".dockerconfigjson": dockerConfigJson },
    },
    { provider, dependsOn },
  );
}

/**
 * The shared Secret plus the checksum every consumer stamps on its pod template.
 *
 * They travel together on purpose: a Secret without its checksum is the silent
 * failure mode this pairing exists to remove (see `secretChecksum`), and
 * computing the hash from the same object literal that becomes `stringData`
 * makes it impossible for the two to drift apart.
 */
export interface AppSecrets {
  secret: k8s.core.v1.Secret;
  /** sha256 (truncated) over every value in `secret`. Not itself sensitive. */
  checksum: pulumi.Output<string>;
}

/**
 * The app's public origin. The BFF pins it from `WORKOS_REDIRECT_URI`
 * (`configuredAppOrigin`), and a signed internal route checks a signature's
 * `@target-uri` against it, so a caller outside the cluster that signs
 * requests (the inbound mail Worker's `BFF_URL`) must be given this same
 * string. One function, so the two cannot drift.
 */
export function appOrigin(cfg: DeployConfig): string {
  return `https://${cfg.ingress.appDomain}`;
}

/**
 * One Kubernetes Secret holding every sensitive value (API keys, tokens, the
 * BYOK KEK, S3 secret key, and the fully-formed DB DSNs — which embed the PG
 * password). Non-secret env is inlined directly on each workload. Values stay
 * encrypted in Pulumi state; this is the only place they are materialised.
 *
 * Consumers inject these with `secretKeyRef`, which is read ONCE at container
 * start — so the returned `checksum` must be stamped on every consuming pod
 * template, or a rotated credential updates this object and changes nothing
 * that is actually running.
 */
export function buildSecrets(w: AppWiring): AppSecrets {
  const { cfg } = w;
  const values: Record<string, pulumi.Input<string>> = {
    ...openrouterSecretValues(cfg),
    TAVILY_API_KEY: cfg.llm.tavilyApiKey,
    INTERNAL_API_TOKEN: cfg.internal.apiToken,
    ADMIN_TOKEN: cfg.internal.adminToken,
    CORPUS_EXPORT_TOKEN: cfg.internal.corpusExportToken,
    // The key map the inbound mail Worker's signatures are checked against
    // (`platform/inbound-mail.ts`, ADR-0138). Its own secret, because it also
    // lives outside the cluster, in a Cloudflare Worker binding. Empty = the
    // signed route answers 503 and the Worker's senders retry.
    INBOUND_MAIL_SIGNING_KEYS: cfg.inboundMail.signingKeys,
    JOB_PAYLOAD_KEK: cfg.internal.jobPayloadKek,
    WEB_PUSH_VAPID_PRIVATE_KEY: cfg.webPush.privateKey,
    // PostHog Support (feedback tickets). Absent unless the stack sets it, so
    // `frontendEnv` can leave the variable off the pod rather than empty.
    ...(cfg.posthog.personalApiKey ? { POSTHOG_PERSONAL_API_KEY: cfg.posthog.personalApiKey } : {}),
    WORKOS_API_KEY: cfg.auth.workosApiKey,
    WORKOS_COOKIE_PASSWORD: cfg.auth.workosCookiePassword,
    BYOK_LOCAL_KEK: cfg.auth.byokLocalKek,
    SEAWEED_SECRET_KEY: cfg.seaweedfs.secretKey,
    // Dedicated READ-ONLY bucket-scoped identity for the aiq-agent tier — the
    // backend must never hold the root `grid` Admin credential (ADR-0039).
    SEAWEED_BACKEND_READ_SECRET_KEY: cfg.seaweedfs.backendReadSecretKey,
    // Bucket LIFECYCLE credential (ADR-0043) — creates a tenant's bucket on its
    // first upload, and drops it on erasure. Separate from the object
    // credential above because SeaweedFS's `Admin:<bucket>` authorises
    // CreateBucket and DeleteBucket together and cannot express one without the
    // other, so the only way to keep "drop a tenant" off the request path is to
    // keep it on a key the request path does not carry.
    SEAWEED_TENANT_ADMIN_SECRET_KEY: cfg.seaweedfs.tenantAdminSecretKey,
    // Embeds the Dragonfly password in its userinfo → secret, exactly like the
    // DSNs below. Inlining it on each pod spec would publish the cache
    // credential to anything with `get pod` in the namespace.
    REDIS_URL: w.redisUrl,
    // DSNs (embed the PG password → secret). Every one states its route
    // (ADR-0083): `pooler` for what is self-contained per transaction, `direct`
    // (`grid-pg-rw`) for what needs one server connection across statements.
    // `postgres.spec.ts` holds this table to the same split.
    NAT_JOB_STORE_DB_URL: w.dsn({ db: JOBS_DB, via: "pooler", driver: "postgresql+asyncpg" }),
    CHECKPOINT_DB: w.dsn({ db: CHECKPOINTS_DB, via: "pooler" }),
    SUMMARY_DB: w.dsn({ db: JOBS_DB, via: "pooler", driver: "postgresql+psycopg" }),
    DEEP_CHECKPOINT_DB: w.dsn({ db: CHECKPOINTS_DB, via: "pooler" }),
    // LISTEN/NOTIFY: a notification reaches the one server session that ran
    // LISTEN, which a transaction pooler does not keep for the client.
    LISTEN_DB_URL: w.dsn({ db: JOBS_DB, via: "direct" }),
    // Session advisory locks (leader election, the re-ingest lock, the reaper):
    // a session owns the lock, so behind a pooler it is taken on one server
    // connection and "released" on another, and the first stays locked.
    LOCK_DB_URL: w.dsn({ db: JOBS_DB, via: "direct" }),
    // The app tier connects as the least-privilege role, so row-level security
    // applies to it (ADR-0041). Migrations get the owner credential below —
    // RLS does not apply to a table's owner, so DDL and backfills still work.
    APP_DATABASE_URL: w.dsn({
      db: APP_DB,
      via: "pooler",
      as: { user: RUNTIME_ROLE, password: cfg.postgres.runtimePassword },
    }),
    APP_MIGRATION_DATABASE_URL: w.dsn({ db: APP_DB, via: "direct" }),
    // The read-write key (ADR-0115): the ingest tier writes, and the backend
    // tiers share one env.
    QDRANT_API_KEY: cfg.qdrant.apiKey,
  };

  const secret = new k8s.core.v1.Secret(
    logicalName("grid-secrets"),
    {
      metadata: { name: SECRET_NAME, namespace: w.namespace },
      stringData: values,
    },
    { provider: w.provider },
  );

  return { secret, checksum: secretChecksum(values) };
}

/**
 * EnvVar sourced from the shared Secret.
 *
 * Exported so a pod spec built outside this module (the storage-alert CronJob)
 * references the Secret by the same constant rather than re-typing its name — a
 * literal that drifted would surface as a pod stuck in CreateContainerConfigError
 * at deploy time, not here.
 */
export function sref(key: string): EnvVar {
  return { name: key, valueFrom: { secretKeyRef: { name: SECRET_NAME, key } } };
}

/** EnvVar with the container name differing from the secret key. */
function srefAs(name: string, key: string): EnvVar {
  return { name, valueFrom: { secretKeyRef: { name: SECRET_NAME, key } } };
}

/**
 * The `api` role's Service (ADR-0082 step B): every backend HTTP call of the
 * BFF, the internal CronJobs and the workers. The chat socket is the one
 * exception, and it has its own URL.
 */
export const BACKEND_URL = `http://${API_TIER}:${PORT.backend}`;

/**
 * The `chat` role's Service: the frontend's WebSocket proxy
 * (`server.js`) and nothing else. With chat affinity on the proxy dials the
 * per-pod address (`BACKEND_POD_WS_TEMPLATE`) and only falls back to this.
 */
export const BACKEND_CHAT_URL = `http://${CHAT_TIER}:${PORT.backend}`;

/**
 * Backend environment shared by every role of the image. Postgres DSNs
 * everywhere (never SQLite) — the hard precondition for durability and any
 * future replica. The admission caps are the
 * backend's VERTICAL scaling levers (see docs/audit/scaling-review-2026-07.md
 * §4, §6). `chatEnv`, `apiEnv` and the worker envs add `PROCESS_ROLE`.
 */

export function backendEnv(w: AppWiring, otelServiceName = "backend-chat", workload: ModelWorkload = "chat"): EnvVar[] {
  const { cfg } = w;
  const env: EnvVar[] = [
    { name: "APP_ENV", value: "production" },
    ...hatchetEnv(),
    { name: "LOG_LEVEL", value: "INFO" },
    { name: "HOST", value: "0.0.0.0" },
    { name: "PORT", value: String(PORT.backend) },
    { name: "CONFIG_FILE", value: cfg.backend.configFile },
    { name: "COLLECTION_NAME", value: "oib_knowledge" },
    // Encrypts DB-claimed job payloads at rest (empty = plaintext, dev only).
    sref("JOB_PAYLOAD_KEK"),
    { name: "NORMS_DIR", value: "configs/norms" },
    // Databases (Postgres, not SQLite).
    sref("NAT_JOB_STORE_DB_URL"),
    sref("CHECKPOINT_DB"),
    sref("SUMMARY_DB"),
    sref("LISTEN_DB_URL"),
    sref("LOCK_DB_URL"),
    // Durable per-job LangGraph checkpointing for async deep-research runs.
    sref("DEEP_CHECKPOINT_DB"),
    // Shared cache (authenticated: the URL carries the password).
    sref("REDIS_URL"),
    // Stateless chat tier via the Dragonfly pub/sub conversation bus (ADR-0028).
    // ON by default — the intended architecture; uses REDIS_URL, fails open to
    // local delivery. Set conversationBus=false to fall back to affinity.
    { name: "CONVERSATION_BUS", value: cfg.conversationBus ? "1" : "0" },
    // The flag the BFF routes by (ADR-0080). The backend reads it for one
    // decision: with the bus down, affinity on fails the one-running-turn fence
    // open (every turn of a conversation reaches one process), off refuses.
    { name: "CHAT_AFFINITY", value: cfg.backend.chatAffinity ? "1" : "0" },
    // How long a terminating replica waits for its turns; the pod's grace period
    // is this plus the endpoint drain and slack (`backendRollout`).
    { name: "CHAT_DRAIN_SECONDS", value: String(cfg.backend.drainSeconds) },
    ...publicSourceFetcherEnv(),
    // Project-memory write path (backend → frontend BFF).
    { name: "FRONTEND_INTERNAL_URL", value: `http://frontend:${PORT.frontend}` },
    sref("INTERNAL_API_TOKEN"),
    sref("ADMIN_TOKEN"),
    // WorkOS, the same two values the frontend gets (frontendEnv). With
    // REQUIRE_AUTH=true the backend enforces job ownership and the signed-envelope
    // rule for JWT callers, and it refuses to boot without a validator, which
    // needs the client id (agent_host/plugin.py). Left unset, every tier ran with
    // ownership off while the frontend required login.
    { name: "REQUIRE_AUTH", value: String(cfg.auth.requireAuth) },
    { name: "WORKOS_CLIENT_ID", value: cfg.auth.workosClientId },
    // OTLP tracing via the cluster collector (ADR-0029 amendment). Producers
    // send plain OTLP in-cluster — the collector alone holds the Langfuse key.
    // HTTP/protobuf to :4318 with the full /v1/traces path: the agent-runtime exporter posts
    // to the endpoint as-is (only SDK env-var defaults get the path appended).
    // OTEL_SERVICE_NAME becomes service.name on the spans so
    // chat tier and worker tier are distinct resources in Langfuse.
    // Injected only when the observability tier is deployed — otherwise every
    // span export would retry against a Service that doesn't exist.
    ...(cfg.observability.enabled
      ? [
          { name: "OTEL_SERVICE_NAME", value: otelServiceName },
          { name: "OTEL_EXPORTER_OTLP_ENDPOINT", value: "http://otel-collector:4318/v1/traces" },
        ]
      : []),
    // PostHog, the Python half of the one configuration the frontend already
    // reads (`NEXT_PUBLIC_POSTHOG_*`): `observability/posthog_client.py` no-ops
    // unless BOTH are set, so both or neither, never a half-configured pod. The
    // token is a public `phc_` key, plain config like the frontend's. Here in
    // `backendEnv` because chat, api, agent-worker and ingest-worker all build
    // from it; none of them has a reason to be the odd one out.
    //
    // No rollout checksum: these are literal env values in the pod template, so
    // changing either rolls every tier by itself (a checksum is for values a
    // pod reads from a Secret or ConfigMap, which Kubernetes does not watch).
    ...posthogEnv(cfg),
    // Langfuse session/user attribution (ADR-0044). Keyed off the LANGFUSE
    // tier, not the observability one, and that distinction is the point:
    // stamping a user id on every span is only worth its privacy cost where
    // there is a store that groups traces by user. A stack that exports only
    // PostHog logs gets no identity attributes at all.
    ...(cfg.langfuse.enabled
      ? [{ name: "TRACE_IDENTITY_ATTRIBUTES", value: "true" }]
      : []),
    // The agent writes its answer checks as Langfuse scores (ADR-0089) through
    // the public API, on the in-cluster Service: `allow-backend-to-langfuse`
    // opens it to the chat, api and agent-worker pods. The keys are a
    // capability only: the prompt store stays off until LANGFUSE_PROMPTS_ENABLED.
    ...langfuseApiEnv(cfg),
    // Admission control (bounds concurrent heavy work — §4.2).
    { name: "MAX_ACTIVE_JOBS_PER_ORG", value: String(cfg.backend.maxActiveJobsPerOrg) },
    { name: "MAX_QUEUED_JOBS_PER_ORG", value: String(cfg.backend.maxQueuedJobsPerOrg) },
    { name: "INGEST_MAX_WORKERS", value: String(cfg.backend.ingestMaxWorkers) },
    { name: "INGEST_MAX_PER_ORG", value: String(cfg.ingestWorker.maxPerOrg) },
    { name: "INGEST_HEAVY_FILE_BYTES", value: String(heavyFileBytesEnv(cfg.ingestWorker)) },
    // No env for the base corpus: it lives in SeaweedFS and the knowledge
    // database (ADR-0082 step A2), and the per-replica cache defaults to
    // /tmp/base-corpus (BASE_CORPUS_CACHE_DIR), a place the pod may lose.
    // LLM / embeddings / VLM (all via OpenRouter), on this workload's own key
    // (`model-keys.ts`) as OPENROUTER_API_KEY, EMBED_API_KEY and VLM_API_KEY.
    ...openrouterKeyEnv(workload, SECRET_NAME),
    sref("TAVILY_API_KEY"),
    { name: "EMBED_MODEL", value: cfg.llm.embedModel },
    { name: "EMBED_BASE_URL", value: cfg.llm.embedBaseUrl },
    { name: "VLM_MODEL", value: cfg.llm.vlmModel },
    { name: "VLM_BASE_URL", value: cfg.llm.vlmBaseUrl },
    // What the OpenRouter keys are asked to carry (ADR-0076, ADR-0081). Set
    // from the stack so the budget is read where `ingestWorkerMaxReplicas` is:
    // `assertVlmPeakFitsCeiling` holds the two together.
    { name: "VLM_FLEET_CONCURRENCY", value: String(cfg.providerLimits.vlmFleetConcurrency) },
    { name: "INGEST_PAGE_READ_PARALLELISM", value: String(cfg.providerLimits.pageReadParallelism) },
    { name: "PROVIDER_LIMIT_CEILING", value: String(cfg.providerLimits.limitCeiling) },
    { name: "PROVIDER_MODEL_LIMIT_CEILING", value: String(cfg.providerLimits.modelLimitCeiling) },
    // No EXTRACT_* here: tables, images and charts are on in code and a
    // flag only switches one off. Setting them per deployment is how production
    // ran without tables and dropped every chart it had paid to analyse.
    // Object storage for the `look` tool (ADR-0039): the backend
    // fetches project/Archiv document bytes directly from SeaweedFS (it resolves
    // the storage key via the internal BFF lookup first). This OVERRIDES the
    // earlier "no SEAWEED_* on the backend" separation — that held while the
    // Python tree had zero S3 consumers (thumbnails went through presigned PUT
    // URLs). The fetch is read-only (get_object only), so the credential is the
    // DEDICATED read-only identity `grid-backend-read` (Read on the documents
    // bucket only, distinct key material) — never the root `grid` Admin
    // credential. The identity is provisioned in the SeaweedFS s3.json by
    // deploy/pulumi/src/data/seaweedfs.ts.
    { name: "SEAWEED_ENDPOINT", value: w.seaweedInternalEndpoint },
    { name: "SEAWEED_PUBLIC_ENDPOINT", value: w.seaweedPublicEndpoint },
    { name: "SEAWEED_ACCESS_KEY", value: cfg.seaweedfs.backendReadAccessKey },
    srefAs("SEAWEED_SECRET_KEY", "SEAWEED_BACKEND_READ_SECRET_KEY"),
    { name: "SEAWEED_BUCKET", value: cfg.seaweedfs.bucket },
  ];
  env.push(...backendQdrantEnv(w));
  return env;
}

/**
 * The shared Qdrant cluster (ADR-0115), the backend's one vector store. There
 * is no embedded store to fall back to: it would live on a disk the pod loses
 * at every restart.
 */
function backendQdrantEnv(w: AppWiring): EnvVar[] {
  return [
    { name: "QDRANT_URL", value: w.qdrantUrl },
    sref("QDRANT_API_KEY"),
    // Left at 1 and 1 on a cluster, every collection would sit on one peer and
    // die with it: the shape the three peers exist to avoid.
    ...(w.cfg.qdrant.replicas > 1
      ? [
          { name: "QDRANT_SHARD_NUMBER", value: String(QDRANT.tenantShards) },
          { name: "QDRANT_REPLICATION_FACTOR", value: String(QDRANT.tenantReplicationFactor) },
        ]
      : []),
  ];
}

/**
 * What only the `chat` role reads: its drain, the affinity flag it fences turns
 * by, and the conversation bus. The `api` role runs none of them.
 */
const CHAT_ONLY_ENV = new Set(["CHAT_DRAIN_SECONDS", "CHAT_AFFINITY", "CONVERSATION_BUS"]);

/** The chat tier's (StatefulSet) environment: the backend env and `PROCESS_ROLE=chat`. */
export function chatEnv(w: AppWiring): EnvVar[] {
  return [...backendEnv(w), { name: "PROCESS_ROLE", value: "chat" }];
}

/**
 * The api tier's (`aiq-api` Deployment) environment: the backend env without
 * what only chat reads, as its own service in traces, and `PROCESS_ROLE=api`.
 */
export function apiEnv(w: AppWiring): EnvVar[] {
  return [
    ...backendEnv(w, "backend-api").filter((e) => !(typeof e.name === "string" && CHAT_ONLY_ENV.has(e.name))),
    { name: "PROCESS_ROLE", value: "api" },
  ];
}

/**
 * Research worker (ADR-0021) environment: the full backend env (DB DSNs, shared
 * Qdrant, LLM keys, object storage — the worker runs the same `run_agent_job`)
 * plus the worker role + per-process concurrency. `PROCESS_ROLE=worker` makes the
 * entrypoint run `python -m agent_host.jobs.worker` with no web server.
 */
export function workerEnv(w: AppWiring): EnvVar[] {
  return [
    ...backendEnv(w, "grid-agent-worker", "research"),
    { name: "PROCESS_ROLE", value: "worker" },
    { name: "RESEARCH_WORKERS", value: String(w.cfg.agentWorker.concurrency) },
    // No drain variable: on SIGTERM the Hatchet SDK waits for the runs it holds
    // for as long as the pod's grace period (`agentWorkerDrainSeconds` + 30 s).
  ];
}

/**
 * What the ingest worker does not get of the backend env: the Langfuse API
 * keys. Ingestion writes no scores and serves no prompt, and no NetworkPolicy
 * lets it reach the Langfuse web tier, so the keys would be a credential with
 * nothing to do but leak.
 */
const INGEST_WITHHELD_ENV = new Set(["LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"]);

/**
 * Ingest worker (ADR-0076) environment: the full backend env (it builds the same
 * ingestor: summary model, shared Qdrant, object store, DSNs) plus the role, its
 * per-process concurrency.
 */
export function ingestWorkerEnv(w: AppWiring, livenessFile: string): EnvVar[] {
  return [
    ...backendEnv(w, "grid-ingest-worker", "ingest").filter(
      (e) => !(typeof e.name === "string" && (e.name === "INGEST_MAX_WORKERS" || INGEST_WITHHELD_ENV.has(e.name))),
    ),
    { name: "PROCESS_ROLE", value: "ingest-worker" },
    { name: "INGEST_MAX_WORKERS", value: String(w.cfg.ingestWorker.concurrency) },
    // What one embedded raster may allocate before it is refused (adapter.py).
    // Set from the stack where the tier's memory is, because it is a memory bound.
    { name: "MAX_IMAGE_PIXELS", value: String(w.cfg.ingestWorker.maxImagePixels) },
    { name: "WORKER_LIVENESS_FILE", value: livenessFile },
  ];
}

/** Frontend (Next.js + BFF + WS gateway) environment. */
export function frontendEnv(w: AppWiring): EnvVar[] {
  const { cfg } = w;
  return [
    { name: "APP_ENV", value: "production" },
    ...hatchetEnv(),
    { name: "REQUIRE_AUTH", value: String(cfg.auth.requireAuth) },
    { name: "LANDING_URL", value: cfg.ingress.webOrigin },
    // Every backend HTTP call goes to the api role; only the WebSocket proxy
    // goes to chat, and it has no fallback to the api URL (ADR-0082 step B).
    { name: "BACKEND_URL", value: BACKEND_URL },
    { name: "BACKEND_CHAT_URL", value: BACKEND_CHAT_URL },
    // Conversation affinity for horizontal chat scaling (ADR-0028): the
    // WS proxy pins a conversation to `chat-<hash>.chat-headless` so
    // its in-process WS/HITL/task state is always on the same replica. With 1
    // replica the proxy falls back to the load-balanced BACKEND_CHAT_URL.
    { name: "BACKEND_REPLICAS", value: String(cfg.backend.replicas) },
    // ADR-0080: "0" hands every socket to the load-balanced Service and lets the
    // conversation bus decide per turn which replica runs it, so the backend can
    // autoscale (backend-scaling.ts). "1" is the hash above, byte for byte.
    { name: "CHAT_AFFINITY", value: cfg.backend.chatAffinity ? "1" : "0" },
    // In-cluster headless-service pod address; traffic never leaves the pod
    // network, so the non-TLS ws scheme below is intentional.
    // nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket
    { name: "BACKEND_POD_WS_TEMPLATE", value: `ws://${CHAT_TIER}-{i}.${CHAT_TIER}-headless:${PORT.backend}` },
    // Frontend replica baseline — lets server.js warn if a multi-replica deploy
    // is missing REDIS_URL (shared cache + WS rate limiter would diverge per pod).
    { name: "FRONTEND_REPLICAS", value: String(cfg.frontend.minReplicas) },
    sref("APP_DATABASE_URL"),
    sref("INTERNAL_API_TOKEN"),
    sref("ADMIN_TOKEN"),
    // The corpus export (`/api/internal/oib-corpus`). No caller since the
    // answer-suite CI workflow was removed; unset disables it.
    sref("CORPUS_EXPORT_TOKEN"),
    // Project mail (ADR-0138). The key map is always wired; empty fails closed. The rest only
    // while the inbox is on (`inboundMailAppEnv`), the Worker's own pause aside.
    sref("INBOUND_MAIL_SIGNING_KEYS"),
    ...inboundMailAppEnv(cfg.inboundMail),
    { name: "ALLOW_AGENT_ORG_MEMORY", value: String(cfg.auth.allowAgentOrgMemory) },
    // WorkOS AuthKit.
    { name: "WORKOS_CLIENT_ID", value: cfg.auth.workosClientId },
    // The agent doors' authorization server (ADR-0122); empty = the doors answer 503.
    { name: "WORKOS_AUTHKIT_DOMAIN", value: cfg.auth.workosAuthkitDomain },
    sref("WORKOS_API_KEY"),
    sref("WORKOS_COOKIE_PASSWORD"),
    // Set BOTH: authkit-nextjs reads the literal NEXT_PUBLIC_ var (works at
    // runtime only while the image is built without it — Next.js would inline
    // a build-time value); WORKOS_REDIRECT_URI is the first-party callback
    // route's explicit runtime override and is immune to build-time inlining.
    { name: "NEXT_PUBLIC_WORKOS_REDIRECT_URI", value: `${appOrigin(cfg)}/api/auth/callback` },
    { name: "WORKOS_REDIRECT_URI", value: `${appOrigin(cfg)}/api/auth/callback` },
    // PostHog product analytics (fail-open: empty host/token keeps the
    // browser client disabled — see apps/workspace/bff/analytics/posthog.ts).
    // Read by the BFF per request into AppConfig, so pointing a deployment at
    // a different project needs no rebuild (the Docker image builds with no
    // env files; a build-time read would bake `undefined` into the bundle).
    { name: "NEXT_PUBLIC_POSTHOG_HOST", value: cfg.posthog.host },
    { name: "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", value: cfg.posthog.projectToken },
    // Session replay: off unless the stack opts in; the browser masks all text
    // and samples at this rate (apps/workspace/bff/analytics/posthog-config.ts).
    { name: "NEXT_PUBLIC_POSTHOG_SESSION_REPLAY", value: cfg.posthog.sessionReplay ? "true" : "false" },
    { name: "NEXT_PUBLIC_POSTHOG_REPLAY_SAMPLE_RATE", value: cfg.posthog.replaySampleRate },
    // PostHog Support (apps/workspace/bff/posthog-support/config.ts): the BFF
    // opens a ticket per feedback report and triages them on Platform ->
    // Feedback. Server-side only, despite living beside the NEXT_PUBLIC_ ones.
    // Both or neither: the project id is meaningless without the key, and the
    // key is in the Secret only when the stack set it.
    ...(cfg.posthog.personalApiKey
      ? [sref("POSTHOG_PERSONAL_API_KEY"), { name: "POSTHOG_PROJECT_ID", value: cfg.posthog.projectId }]
      : []),
    // Web Push for the inbox (ADR-0112). Empty = off. The bff-jobs pool inherits
    // these (`bffJobsEnv`) and is the one that sends; the frontend serves the
    // public key to the browser.
    { name: "WEB_PUSH_VAPID_PUBLIC_KEY", value: cfg.webPush.publicKey },
    sref("WEB_PUSH_VAPID_PRIVATE_KEY"),
    { name: "WEB_PUSH_SUBJECT", value: cfg.webPush.subject },
    // BYOK.
    { name: "BYOK_SECRET_BACKEND", value: cfg.auth.byokSecretBackend },
    sref("BYOK_LOCAL_KEK"),
    { name: "BYOK_ALLOW_PRIVATE_BASE_URLS", value: "false" },
    // Object storage (public endpoint signs browser presigned URLs).
    { name: "SEAWEED_ENDPOINT", value: w.seaweedInternalEndpoint },
    { name: "SEAWEED_PUBLIC_ENDPOINT", value: w.seaweedPublicEndpoint },
    { name: "SEAWEED_ACCESS_KEY", value: cfg.seaweedfs.accessKey },
    sref("SEAWEED_SECRET_KEY"),
    { name: "SEAWEED_BUCKET", value: cfg.seaweedfs.bucket },
    // Per-organization buckets (ADR-0043). Off by default; the bucket each
    // document actually lives in is recorded on its row, so flipping this
    // changes where the NEXT object goes and nothing else.
    { name: "SEAWEED_PER_ORG_BUCKETS", value: String(cfg.seaweedfs.perOrgBuckets) },
    { name: "SEAWEED_TENANT_BUCKET_PREFIX", value: cfg.seaweedfs.tenantBucketPrefix },
    { name: "SEAWEED_TENANT_ADMIN_ACCESS_KEY", value: cfg.seaweedfs.tenantAdminAccessKey },
    sref("SEAWEED_TENANT_ADMIN_SECRET_KEY"),
    { name: "SEAWEED_PRESIGNED_URL_TTL_SECONDS", value: String(APP_DEFAULTS.presignedUrlTtlSeconds) },
    { name: "PROJECT_PURGE_GRACE_DAYS", value: String(APP_DEFAULTS.projectPurgeGraceDays) },
    { name: "FOLDER_PURGE_GRACE_DAYS", value: String(APP_DEFAULTS.folderPurgeGraceDays) },
    // Model catalog reads (no completions, so no credit spent): the chat key,
    // which the Secret holds under this name. Pricing is a platform setting.
    sref("OPENROUTER_API_KEY"),
    // Platform tier.
    { name: "PLATFORM_OWNER_EMAILS", value: cfg.auth.platformOwnerEmails },
    { name: "PLATFORM_ORG_EXTERNAL_ID", value: cfg.auth.platformOrgExternalId },
    { name: "DISABLE_SELF_SERVE_ORGS", value: String(cfg.auth.disableSelfServeOrgs) },
    { name: "AUDIT_LOGS_ENABLED", value: String(cfg.auth.auditLogsEnabled) },
    // Platform knowledge governance: `true` lets one operator approve and publish alone (dev only).
    { name: "KNOWLEDGE_SINGLE_OPERATOR", value: String(cfg.auth.knowledgeSingleOperator) },
    // Shared cache + WS rate limiting (needed for >1 replica correctness).
    // Authenticated: the URL carries the password, so it comes from the Secret.
    sref("REDIS_URL"),
    { name: "WS_UPGRADE_RATE_LIMIT", value: String(APP_DEFAULTS.wsUpgradeRateLimit) },
    // Graceful shutdown: how long server.js keeps serving after SIGTERM before
    // forcing exit. Chat WebSockets are long-lived, so the 2s dev default would
    // drop every streaming answer in flight on each deploy. Must stay inside the
    // pod's terminationGracePeriodSeconds (see ROLLOUT.frontend in rollout.ts).
    { name: "SHUTDOWN_DRAIN_MS", value: String(FRONTEND_DRAIN_SECONDS * 1000) },
    // Agent Skills + Jobs (ADR-0046). Whether the feature exists for an
    // organization is its `skills` WorkOS flag, like every other feature
    // (`apps/workspace/bff/authz/feature-flags.ts`); only the scheduling
    // floor is deployment configuration.
    { name: "SKILL_MIN_INTERVAL_MINUTES", value: String(cfg.skills.minIntervalMinutes) },
    // Storage-quota alerting (ADR-0042). Read by the sweep behind
    // /api/internal/storage/alerts, which the storage-alerts CronJob calls — so
    // it belongs to the frontend even though nothing renders it. Escalation to
    // 90% and 100% above this value is automatic.
    {
      name: "STORAGE_ALERT_THRESHOLD_PERCENT",
      value: String(cfg.storageAlerts.thresholdPercent),
    },
    // Office → PDF rendition (ADR-0070). Frontend-only: the BFF is the one
    // converter; the backend receives the finished PDF as `preview_ref`, and
    // for Word/presentation/.xls/.ods also as `extraction_ref`, the only
    // source it indexes those from (ADR-0071). Absent ⇒ those files are
    // marked failed (retryable); .xlsx/.xlsm index without preview.
    ...(w.gotenbergUrl ? [{ name: "GOTENBERG_URL", value: w.gotenbergUrl }] : []),
    // Address search for the project dialog (ADR-0151), behind `/api/geocode`:
    // off unless the stack sets `geocoderUrl` (ADR-0159). Empty ⇒ the route
    // answers `enabled: false` and the address stays a plain text field.
    ...(cfg.geocoderUrl ? [{ name: "GEOCODER_URL", value: cfg.geocoderUrl }] : []),
    // The malware scanner (ADR-0157): the in-cluster clamd, never anything
    // else. Inherited by the bff-jobs pool, whose receive jobs scan what
    // arrives; the request path scans an original before serving it. Absent ⇒
    // every scan fails `not-configured`, and nothing waiting on one is filed.
    ...(w.malwareScanUrl ? [{ name: "MALWARE_SCAN_URL", value: w.malwareScanUrl }] : []),
    // OTLP via the collector, only when it is deployed (instrumentation.ts no-ops
    // without it). A BASE URL: the JS exporter appends the signal path, the
    // Python agent-runtime exporter does not, so the backend gets /v1/traces.
    ...(cfg.observability.enabled
      ? [
          { name: "OTEL_SERVICE_NAME", value: BFF_SERVICE_NAME },
          { name: "OTEL_EXPORTER_OTLP_ENDPOINT", value: "http://otel-collector:4318" },
        ]
      : []),
    // Answer feedback as Langfuse scores, and links from a rated turn to its
    // trace (ADR-0044, Amendment 3). Only where the Langfuse tier is deployed.
    ...frontendLangfuseEnv(cfg),
  ];
}

/**
 * How a worker reaches Langfuse's public API (`workers/langfuse-traces.js`):
 * the in-cluster web Service and the project key pair that the Langfuse Secret
 * already holds for the collector and for headless init. Present exactly when
 * the Langfuse tier is deployed; without it the worker's step is a logged
 * no-op, which is also what a deployment without Langfuse has to do.
 *
 * The Secret is Langfuse's own rather than a copy in `grid-secrets`, so a key
 * rotation has one place to happen. A pod reads it at start, so every pod that
 * carries this env folds the keys into its rollout checksum
 * (`withLangfuseKeysChecksum`) and a rotation rolls it.
 *
 * Also on the backend tiers (`backendEnv`), which write the answer pipeline's
 * checks as scores (ADR-0089, `agent/observability/langfuse_scores.py`)
 * and, once `LANGFUSE_PROMPTS_ENABLED` is set, read the platform prompt.
 */
export function langfuseApiEnv(cfg: DeployConfig): EnvVar[] {
  if (!cfg.langfuse.enabled) return [];
  const fromLangfuseSecret = (name: string, key: string): EnvVar => ({
    name,
    valueFrom: { secretKeyRef: { name: LANGFUSE_SECRETS_NAME, key } },
  });
  return [
    { name: "LANGFUSE_HOST", value: `http://${LANGFUSE.web}:${PORT.langfuseWeb}` },
    fromLangfuseSecret("LANGFUSE_PUBLIC_KEY", LANGFUSE_SECRET_KEYS.publicKey),
    fromLangfuseSecret("LANGFUSE_SECRET_KEY", LANGFUSE_SECRET_KEYS.secretKey),
  ];
}

/** Purger worker environment. */
export function purgerEnv(w: AppWiring): EnvVar[] {
  const { cfg } = w;
  return [
    sref("APP_DATABASE_URL"),
    { name: "BACKEND_URL", value: BACKEND_URL },
    // A chat erasure the delete request could not finish is retried through the
    // BFF, which owns its steps (`purger/purge-conversation.js`).
    { name: "FRONTEND_INTERNAL_URL", value: `http://frontend:${PORT.frontend}` },
    sref("INTERNAL_API_TOKEN"),
    { name: "SEAWEED_ENDPOINT", value: w.seaweedInternalEndpoint },
    { name: "SEAWEED_ACCESS_KEY", value: cfg.seaweedfs.accessKey },
    sref("SEAWEED_SECRET_KEY"),
    { name: "SEAWEED_BUCKET", value: cfg.seaweedfs.bucket },
    // Deliberately no per-organization bucket variables. The purge reads which
    // buckets a project's documents recorded rather than deriving them from the
    // organization id (ADR-0043), so it needs neither the naming rule, the
    // feature flag, nor the bucket-admin credential — and an unattended queue
    // worker is the last process that should be able to drop a bucket.
    sref("WORKOS_API_KEY"),
    // An erased chat's Langfuse traces are deleted by the purger (ADR-0044).
    ...langfuseApiEnv(cfg),
    { name: "PURGER_POLL_INTERVAL_MS", value: String(APP_DEFAULTS.purgerPollMs) },
    // OTLP logs via the cluster collector (see frontendEnv for the gating
    // rationale). Base URL - the JS exporter derives /v1/logs.
    ...(cfg.observability.enabled
      ? [
          { name: "OTEL_SERVICE_NAME", value: "grid-purger" },
          { name: "OTEL_EXPORTER_OTLP_ENDPOINT", value: "http://otel-collector:4318" },
        ]
      : []),
  ];
}
