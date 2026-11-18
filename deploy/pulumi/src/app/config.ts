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
import { posthogDeploymentEnv, posthogEnv } from "./posthog-env";
import { hatchetEnv } from "./hatchet-env";
import { publicSourceFetcherEnv } from "./public-source-fetcher";
import { codeRunnerEnv } from "./code-runner";
import { openrouterKeyEnv, openrouterSecretValues } from "./model-keys";
import type { ModelWorkload } from "../config/app-services";
import { heavyFileBytesEnv } from "../config/workers";

export const BFF_SERVICE_NAME = "grid-ui";
type EnvVar = k8s.types.input.core.v1.EnvVar;

export interface AppWiring {
  cfg: DeployConfig;
  namespace: pulumi.Input<string>;
  provider: k8s.Provider;
  redisUrl: pulumi.Output<string>;
  seaweedInternalEndpoint: pulumi.Output<string>;
  seaweedPublicEndpoint: pulumi.Output<string>;
  gotenbergUrl?: pulumi.Output<string>;
  malwareScanUrl?: pulumi.Output<string>;
  codeRunnerUrl?: pulumi.Output<string>;
  qdrantUrl: pulumi.Output<string>;
  dsn: Postgres["dsn"];
  imagePullSecrets: { name: string }[];
}

export const SECRET_NAME = objectName("appSecret"); // pragma: allowlist secret (Kubernetes Secret resource name, not a credential)
export const PULL_SECRET_NAME = objectName("registryPullSecret"); // pragma: allowlist secret (Kubernetes Secret resource name, not a credential)

export function buildRegistryPullSecret(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  resourceName = logicalName("grid-registry-pull"), dependsOn: pulumi.Resource[] = [],
): k8s.core.v1.Secret | undefined {
  const creds = cfg.images.pullCredentials;
  if (!creds) return undefined;
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

export interface AppSecrets {
  secret: k8s.core.v1.Secret;
  checksum: pulumi.Output<string>;
}

export function appOrigin(cfg: DeployConfig): string {
  return `https://${cfg.ingress.appDomain}`;
}

export function buildSecrets(w: AppWiring): AppSecrets {
  const { cfg } = w;
  const values: Record<string, pulumi.Input<string>> = {
    ...openrouterSecretValues(cfg),
    TAVILY_API_KEY: cfg.llm.tavilyApiKey,
    INTERNAL_API_TOKEN: cfg.internal.apiToken,
    ADMIN_TOKEN: cfg.internal.adminToken,
    CORPUS_EXPORT_TOKEN: cfg.internal.corpusExportToken,
    INBOUND_MAIL_SIGNING_KEYS: cfg.inboundMail.signingKeys,
    JOB_PAYLOAD_KEK: cfg.internal.jobPayloadKek,
    WEB_PUSH_VAPID_PRIVATE_KEY: cfg.webPush.privateKey,
    ...(cfg.posthog.personalApiKey ? { POSTHOG_PERSONAL_API_KEY: cfg.posthog.personalApiKey } : {}),
    WORKOS_API_KEY: cfg.auth.workosApiKey,
    WORKOS_COOKIE_PASSWORD: cfg.auth.workosCookiePassword,
    BYOK_LOCAL_KEK: cfg.auth.byokLocalKek,
    SEAWEED_SECRET_KEY: cfg.seaweedfs.secretKey,
    SEAWEED_BACKEND_READ_SECRET_KEY: cfg.seaweedfs.backendReadSecretKey,
    SEAWEED_TENANT_ADMIN_SECRET_KEY: cfg.seaweedfs.tenantAdminSecretKey,
    REDIS_URL: w.redisUrl,
    NAT_JOB_STORE_DB_URL: w.dsn({ db: JOBS_DB, via: "pooler", driver: "postgresql+asyncpg" }),
    CHECKPOINT_DB: w.dsn({ db: CHECKPOINTS_DB, via: "pooler" }),
    SUMMARY_DB: w.dsn({ db: JOBS_DB, via: "pooler", driver: "postgresql+psycopg" }),
    DEEP_CHECKPOINT_DB: w.dsn({ db: CHECKPOINTS_DB, via: "pooler" }),
    LISTEN_DB_URL: w.dsn({ db: JOBS_DB, via: "direct" }),
    LOCK_DB_URL: w.dsn({ db: JOBS_DB, via: "direct" }),
    APP_DATABASE_URL: w.dsn({
      db: APP_DB,
      via: "pooler",
      as: { user: RUNTIME_ROLE, password: cfg.postgres.runtimePassword },
    }),
    APP_MIGRATION_DATABASE_URL: w.dsn({ db: APP_DB, via: "direct" }),
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

export function sref(key: string): EnvVar {
  return { name: key, valueFrom: { secretKeyRef: { name: SECRET_NAME, key } } };
}

function srefAs(name: string, key: string): EnvVar {
  return { name, valueFrom: { secretKeyRef: { name: SECRET_NAME, key } } };
}

export const BACKEND_URL = `http://${API_TIER}:${PORT.backend}`;

export const BACKEND_CHAT_URL = `http://${CHAT_TIER}:${PORT.backend}`;

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
    sref("JOB_PAYLOAD_KEK"),
    { name: "NORMS_DIR", value: "configs/norms" },
    sref("NAT_JOB_STORE_DB_URL"),
    sref("CHECKPOINT_DB"),
    sref("SUMMARY_DB"),
    sref("LISTEN_DB_URL"),
    sref("LOCK_DB_URL"),
    sref("DEEP_CHECKPOINT_DB"),
    sref("REDIS_URL"),
    { name: "CONVERSATION_BUS", value: cfg.conversationBus ? "1" : "0" },
    { name: "CHAT_AFFINITY", value: cfg.backend.chatAffinity ? "1" : "0" },
    { name: "CHAT_DRAIN_SECONDS", value: String(cfg.backend.drainSeconds) },
    ...publicSourceFetcherEnv(),
    { name: "FRONTEND_INTERNAL_URL", value: `http://frontend:${PORT.frontend}` },
    sref("INTERNAL_API_TOKEN"),
    sref("ADMIN_TOKEN"),
    { name: "REQUIRE_AUTH", value: String(cfg.auth.requireAuth) },
    { name: "WORKOS_CLIENT_ID", value: cfg.auth.workosClientId },
    ...(cfg.observability.enabled
      ? [
          { name: "OTEL_SERVICE_NAME", value: otelServiceName },
          { name: "OTEL_EXPORTER_OTLP_ENDPOINT", value: "http://otel-collector:4318/v1/traces" },
        ]
      : []),
    ...posthogEnv(cfg),
    ...(cfg.langfuse.enabled
      ? [{ name: "TRACE_IDENTITY_ATTRIBUTES", value: "true" }]
      : []),
    ...langfuseApiEnv(cfg),
    { name: "MAX_ACTIVE_JOBS_PER_ORG", value: String(cfg.backend.maxActiveJobsPerOrg) },
    { name: "MAX_QUEUED_JOBS_PER_ORG", value: String(cfg.backend.maxQueuedJobsPerOrg) },
    { name: "INGEST_MAX_WORKERS", value: String(cfg.backend.ingestMaxWorkers) },
    { name: "INGEST_MAX_PER_ORG", value: String(cfg.ingestWorker.maxPerOrg) },
    { name: "INGEST_HEAVY_FILE_BYTES", value: String(heavyFileBytesEnv(cfg.ingestWorker)) },
    ...openrouterKeyEnv(workload, SECRET_NAME),
    sref("TAVILY_API_KEY"),
    { name: "EMBED_MODEL", value: cfg.llm.embedModel },
    { name: "EMBED_BASE_URL", value: cfg.llm.embedBaseUrl },
    { name: "VLM_MODEL", value: cfg.llm.vlmModel },
    { name: "VLM_BASE_URL", value: cfg.llm.vlmBaseUrl },
    { name: "VLM_FLEET_CONCURRENCY", value: String(cfg.providerLimits.vlmFleetConcurrency) },
    { name: "INGEST_PAGE_READ_PARALLELISM", value: String(cfg.providerLimits.pageReadParallelism) },
    { name: "PROVIDER_LIMIT_CEILING", value: String(cfg.providerLimits.limitCeiling) },
    { name: "PROVIDER_MODEL_LIMIT_CEILING", value: String(cfg.providerLimits.modelLimitCeiling) },
    { name: "SEAWEED_ENDPOINT", value: w.seaweedInternalEndpoint },
    { name: "SEAWEED_PUBLIC_ENDPOINT", value: w.seaweedPublicEndpoint },
    { name: "SEAWEED_ACCESS_KEY", value: cfg.seaweedfs.backendReadAccessKey },
    srefAs("SEAWEED_SECRET_KEY", "SEAWEED_BACKEND_READ_SECRET_KEY"),
    { name: "SEAWEED_BUCKET", value: cfg.seaweedfs.bucket },
  ];
  env.push(...backendQdrantEnv(w));
  return env;
}

export function backendQdrantEnv(w: AppWiring): EnvVar[] {
  return [
    { name: "QDRANT_URL", value: w.qdrantUrl },
    sref("QDRANT_API_KEY"),
    ...(w.cfg.qdrant.replicas > 1
      ? [
          { name: "QDRANT_SHARD_NUMBER", value: String(QDRANT.tenantShards) },
          { name: "QDRANT_REPLICATION_FACTOR", value: String(QDRANT.tenantReplicationFactor) },
        ]
      : []),
  ];
}

const CHAT_ONLY_ENV = new Set(["CHAT_DRAIN_SECONDS", "CHAT_AFFINITY", "CONVERSATION_BUS"]);

export function chatEnv(w: AppWiring): EnvVar[] {
  return [...backendEnv(w), ...codeRunnerEnv(w.codeRunnerUrl), { name: "PROCESS_ROLE", value: "chat" }];
}

export function apiEnv(w: AppWiring): EnvVar[] {
  return [
    ...backendEnv(w, "backend-api").filter((e) => !(typeof e.name === "string" && CHAT_ONLY_ENV.has(e.name))),
    { name: "PROCESS_ROLE", value: "api" },
  ];
}

export function workerEnv(w: AppWiring): EnvVar[] {
  return [
    ...backendEnv(w, "grid-agent-worker", "research"),
    ...codeRunnerEnv(w.codeRunnerUrl),
    { name: "PROCESS_ROLE", value: "worker" },
    { name: "RESEARCH_WORKERS", value: String(w.cfg.agentWorker.concurrency) },
  ];
}

const INGEST_WITHHELD_ENV = new Set(["LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"]);

export function ingestWorkerEnv(w: AppWiring, livenessFile: string): EnvVar[] {
  return [
    ...backendEnv(w, "grid-ingest-worker", "ingest").filter(
      (e) => !(typeof e.name === "string" && (e.name === "INGEST_MAX_WORKERS" || INGEST_WITHHELD_ENV.has(e.name))),
    ),
    { name: "PROCESS_ROLE", value: "ingest-worker" },
    { name: "INGEST_MAX_WORKERS", value: String(w.cfg.ingestWorker.concurrency) },
    { name: "MAX_IMAGE_PIXELS", value: String(w.cfg.ingestWorker.maxImagePixels) },
    { name: "WORKER_LIVENESS_FILE", value: livenessFile },
  ];
}

export function frontendEnv(w: AppWiring): EnvVar[] {
  const { cfg } = w;
  return [
    { name: "APP_ENV", value: "production" },
    ...hatchetEnv(),
    { name: "REQUIRE_AUTH", value: String(cfg.auth.requireAuth) },
    { name: "LANDING_URL", value: cfg.ingress.webOrigin },
    { name: "BACKEND_URL", value: BACKEND_URL },
    { name: "BACKEND_CHAT_URL", value: BACKEND_CHAT_URL },
    { name: "BACKEND_REPLICAS", value: String(cfg.backend.replicas) },
    { name: "CHAT_AFFINITY", value: cfg.backend.chatAffinity ? "1" : "0" },
    // nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket
    { name: "BACKEND_POD_WS_TEMPLATE", value: `ws://${CHAT_TIER}-{i}.${CHAT_TIER}-headless:${PORT.backend}` },
    { name: "FRONTEND_REPLICAS", value: String(cfg.frontend.minReplicas) },
    sref("APP_DATABASE_URL"),
    sref("INTERNAL_API_TOKEN"),
    sref("ADMIN_TOKEN"),
    sref("CORPUS_EXPORT_TOKEN"),
    sref("INBOUND_MAIL_SIGNING_KEYS"),
    ...inboundMailAppEnv(cfg.inboundMail),
    { name: "ALLOW_AGENT_ORG_MEMORY", value: String(cfg.auth.allowAgentOrgMemory) },
    { name: "WORKOS_CLIENT_ID", value: cfg.auth.workosClientId },
    { name: "WORKOS_AUTHKIT_DOMAIN", value: cfg.auth.workosAuthkitDomain },
    sref("WORKOS_API_KEY"),
    sref("WORKOS_COOKIE_PASSWORD"),
    { name: "NEXT_PUBLIC_WORKOS_REDIRECT_URI", value: `${appOrigin(cfg)}/api/auth/callback` },
    { name: "WORKOS_REDIRECT_URI", value: `${appOrigin(cfg)}/api/auth/callback` },
    { name: "NEXT_PUBLIC_POSTHOG_HOST", value: cfg.posthog.host },
    { name: "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", value: cfg.posthog.projectToken },
    { name: "NEXT_PUBLIC_POSTHOG_SESSION_REPLAY", value: cfg.posthog.sessionReplay ? "true" : "false" },
    { name: "NEXT_PUBLIC_POSTHOG_REPLAY_SAMPLE_RATE", value: cfg.posthog.replaySampleRate },
    posthogDeploymentEnv(),
    ...(cfg.posthog.personalApiKey
      ? [sref("POSTHOG_PERSONAL_API_KEY"), { name: "POSTHOG_PROJECT_ID", value: cfg.posthog.projectId }]
      : []),
    { name: "WEB_PUSH_VAPID_PUBLIC_KEY", value: cfg.webPush.publicKey },
    sref("WEB_PUSH_VAPID_PRIVATE_KEY"),
    { name: "WEB_PUSH_SUBJECT", value: cfg.webPush.subject },
    { name: "BYOK_SECRET_BACKEND", value: cfg.auth.byokSecretBackend },
    sref("BYOK_LOCAL_KEK"),
    { name: "BYOK_ALLOW_PRIVATE_BASE_URLS", value: "false" },
    { name: "SEAWEED_ENDPOINT", value: w.seaweedInternalEndpoint },
    { name: "SEAWEED_PUBLIC_ENDPOINT", value: w.seaweedPublicEndpoint },
    { name: "SEAWEED_ACCESS_KEY", value: cfg.seaweedfs.accessKey },
    sref("SEAWEED_SECRET_KEY"),
    { name: "SEAWEED_BUCKET", value: cfg.seaweedfs.bucket },
    { name: "SEAWEED_PER_ORG_BUCKETS", value: String(cfg.seaweedfs.perOrgBuckets) },
    { name: "SEAWEED_TENANT_BUCKET_PREFIX", value: cfg.seaweedfs.tenantBucketPrefix },
    { name: "SEAWEED_TENANT_ADMIN_ACCESS_KEY", value: cfg.seaweedfs.tenantAdminAccessKey },
    sref("SEAWEED_TENANT_ADMIN_SECRET_KEY"),
    { name: "SEAWEED_PRESIGNED_URL_TTL_SECONDS", value: String(APP_DEFAULTS.presignedUrlTtlSeconds) },
    { name: "PROJECT_PURGE_GRACE_DAYS", value: String(APP_DEFAULTS.projectPurgeGraceDays) },
    { name: "FOLDER_PURGE_GRACE_DAYS", value: String(APP_DEFAULTS.folderPurgeGraceDays) },
    sref("OPENROUTER_API_KEY"),
    { name: "PLATFORM_OWNER_EMAILS", value: cfg.auth.platformOwnerEmails },
    { name: "PLATFORM_ORG_EXTERNAL_ID", value: cfg.auth.platformOrgExternalId },
    { name: "DISABLE_SELF_SERVE_ORGS", value: String(cfg.auth.disableSelfServeOrgs) },
    { name: "AUDIT_LOGS_ENABLED", value: String(cfg.auth.auditLogsEnabled) },
    { name: "KNOWLEDGE_SINGLE_OPERATOR", value: String(cfg.auth.knowledgeSingleOperator) },
    sref("REDIS_URL"),
    { name: "WS_UPGRADE_RATE_LIMIT", value: String(APP_DEFAULTS.wsUpgradeRateLimit) },
    { name: "SHUTDOWN_DRAIN_MS", value: String(FRONTEND_DRAIN_SECONDS * 1000) },
    { name: "SKILL_MIN_INTERVAL_MINUTES", value: String(cfg.skills.minIntervalMinutes) },
    {
      name: "STORAGE_ALERT_THRESHOLD_PERCENT",
      value: String(cfg.storageAlerts.thresholdPercent),
    },
    ...(w.gotenbergUrl ? [{ name: "GOTENBERG_URL", value: w.gotenbergUrl }] : []),
    ...(cfg.geocoderUrl ? [{ name: "GEOCODER_URL", value: cfg.geocoderUrl }] : []),
    ...(w.malwareScanUrl ? [{ name: "MALWARE_SCAN_URL", value: w.malwareScanUrl }] : []),
    ...(cfg.observability.enabled
      ? [
          { name: "OTEL_SERVICE_NAME", value: BFF_SERVICE_NAME },
          { name: "OTEL_EXPORTER_OTLP_ENDPOINT", value: "http://otel-collector:4318" },
        ]
      : []),
    ...frontendLangfuseEnv(cfg),
  ];
}

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

export function purgerEnv(w: AppWiring): EnvVar[] {
  const { cfg } = w;
  return [
    sref("APP_DATABASE_URL"),
    { name: "BACKEND_URL", value: BACKEND_URL },
    { name: "FRONTEND_INTERNAL_URL", value: `http://frontend:${PORT.frontend}` },
    sref("INTERNAL_API_TOKEN"),
    { name: "SEAWEED_ENDPOINT", value: w.seaweedInternalEndpoint },
    { name: "SEAWEED_ACCESS_KEY", value: cfg.seaweedfs.accessKey },
    sref("SEAWEED_SECRET_KEY"),
    { name: "SEAWEED_BUCKET", value: cfg.seaweedfs.bucket },
    sref("WORKOS_API_KEY"),
    ...langfuseApiEnv(cfg),
    { name: "PURGER_POLL_INTERVAL_MS", value: String(APP_DEFAULTS.purgerPollMs) },
    ...(cfg.observability.enabled
      ? [
          { name: "OTEL_SERVICE_NAME", value: "grid-purger" },
          { name: "OTEL_EXPORTER_OTLP_ENDPOINT", value: "http://otel-collector:4318" },
        ]
      : []),
  ];
}
