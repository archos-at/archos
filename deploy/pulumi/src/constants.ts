import { objectName } from "./names";

export const UID = {
  qdrant: 1000,
  backend: 1000,
  frontend: 1001,
  web: 1001,
  gotenberg: 1001,
} as const;

export const PORT = {
  backend: 8000,
  frontend: 3000,
  web: 4321,
  redis: 6379,
  postgres: 5432,
  seaweedS3: 8333,
  seaweedMaster: 9333,
  seaweedMasterGrpc: 19333,
  seaweedFiler: 8888,
  seaweedFilerGrpc: 18888,
  seaweedVolume: 8080,
  seaweedVolumeGrpc: 18080,
  langfuseWeb: 3000,
  langfuseWorker: 3030,
  clickhouseHttp: 8123,
  clickhouseNative: 9000,
  clickhouseMetrics: 9363,
  gotenberg: 3000,
  qdrantHttp: 6333,
  qdrantGrpc: 6334,
  qdrantP2p: 6335,
  qdrantMetrics: 6336,
  seaweedMetrics: 9327,
  postgresMetrics: 9187,
  poolerMetrics: 9127,
} as const;

export const SEAWEED = {
  filer: "seaweedfs",
  filerPeer: "seaweedfs-filer-peer",
  master: "seaweedfs-master",
  masterPeer: "seaweedfs-master-peer",
  volume: "seaweedfs-volume",
  volumePeer: "seaweedfs-volume-peer",
} as const;

export const EDGE_TIMEOUT = "3600s";

export const EDGE_RETRY = {
  numRetries: 3,
  baseInterval: "100ms",
  maxInterval: "1s",
} as const;

export const BOOTSTRAP_JOB_RESOURCES = {
  requests: { cpu: "25m", memory: "64Mi" },
  limits: { cpu: "250m", memory: "256Mi" },
} as const;

export const LIGHT_WORKER_RESOURCES = {
  requests: { cpu: "50m", memory: "128Mi" },
  limits: { cpu: "500m", memory: "512Mi" },
} as const;

export const PLATFORM_RESOURCES = {
  certManager: {
    requests: { cpu: "10m", memory: "64Mi" },
    limits: { cpu: "100m", memory: "128Mi" },
  },
  metricsServer: {
    requests: { cpu: "50m", memory: "64Mi" },
    limits: { cpu: "200m", memory: "256Mi" },
  },
  cnpgOperator: {
    requests: { cpu: "50m", memory: "128Mi" },
    limits: { cpu: "500m", memory: "512Mi" },
  },
  kedaOperator: {
    requests: { cpu: "50m", memory: "128Mi" },
    limits: { cpu: "500m", memory: "512Mi" },
  },
  kedaMetricServer: {
    requests: { cpu: "50m", memory: "128Mi" },
    limits: { cpu: "500m", memory: "512Mi" },
  },
  kedaWebhooks: {
    requests: { cpu: "10m", memory: "64Mi" },
    limits: { cpu: "200m", memory: "256Mi" },
  },
  envoyProxy: {
    requests: { cpu: "100m", memory: "128Mi" },
    limits: { cpu: "1", memory: "512Mi" },
  },
} as const;

export const NODE_GROUP_LABEL = "k8s.at/node-group";

export const AUTOSCALER_SAFE_TO_EVICT = "cluster-autoscaler.kubernetes.io/safe-to-evict";

export const DATA_RESOURCES = {
  postgres: {
    requests: { cpu: "1750m", memory: "1Gi" },
    limits: { cpu: "2", memory: "4Gi" },
  },
  dragonflyRequests: { cpu: "50m", memory: "128Mi" },
  dragonflyCpuLimit: "500m", // memory limit is the `dragonflyMemoryLimit` knob
  seaweedfs: {
    requests: { cpu: "1500m", memory: "256Mi" },
    limits: { cpu: "3", memory: "1Gi" },
  },
  seaweedfsMaster: {
    requests: { cpu: "50m", memory: "128Mi" },
    limits: { cpu: "500m", memory: "512Mi" },
  },
  seaweedfsVolume: {
    requests: { cpu: "100m", memory: "256Mi" },
    limits: { cpu: "1", memory: "2Gi" },
  },
  seaweedfsFiler: {
    requests: { cpu: "100m", memory: "256Mi" },
    limits: { cpu: "1", memory: "1Gi" },
  },
  clickhouse: {
    requests: { cpu: "2", memory: "1Gi" },
    limits: { cpu: "2", memory: "4Gi" },
  },
} as const;

export const LANGFUSE = {
  web: "langfuse-web",
  worker: "langfuse-worker",
  clickhouse: "clickhouse",
  queue: "dragonfly-langfuse",
  database: "langfuse",
  databaseUser: "langfuse_app",
  clickhouseDatabase: "langfuse",
  clickhouseUser: "langfuse",
  bucket: "langfuse",
  eventPrefix: "events/",
  batchExportPrefix: "exports/",
  s3Identity: "grid-langfuse",
  routeName: objectName("langfuseRoute"),
  listenerName: "https-langfuse",
  otlpTracesPath: "/api/public/otel/v1/traces",
  webResources: {
    requests: { cpu: "1", memory: "1Gi" },
    limits: { cpu: "1", memory: "2Gi" },
  },
  workerResources: {
    requests: { cpu: "200m", memory: "1Gi" },
    limits: { cpu: "2", memory: "3Gi" },
  },
} as const;

export const EDGE_RATE_LIMIT = {
  storeService: "dragonfly-ratelimit",
  timeout: "250ms",
  paths: {
    auth: "/api/auth",
    ws: "/websocket",
  },
} as const;

export const GOTENBERG = {
  name: "gotenberg",
  args: [
    "gotenberg",
    "--api-timeout=120s",
    "--api-disable-download-from",
    "--webhook-disable",
    "--libreoffice-auto-start=true",
    "--gotenberg-graceful-shutdown-duration=120s",
    "--libreoffice-deny-private-ips",
    "--libreoffice-deny-public-ips",
  ],
  resources: {
    requests: { cpu: "200m", memory: "512Mi" },
    limits: { cpu: "1", memory: "1Gi" },
  },
} as const;

export const KEDA_SCALER_ROLE = "keda_scaler";

export const KEDA_SCALER_CONNECTION_LIMIT = 8;
export const BACKFILL_POD = "app-backfill";

export const JOB_DEFAULTS = {
  backoffLimit: 10,
  ttlSecondsAfterFinished: 300,
} as const;

export const APP_DEFAULTS = {
  wsUpgradeRateLimit: 30,
  presignedUrlTtlSeconds: 600,
  projectPurgeGraceDays: 7,
  folderPurgeGraceDays: 14,
  purgerPollMs: 60_000,
  skillRunsRetentionDays: 90,
  langfuseTraceRetentionDays: 30,
} as const;

export const POSTGRES_TUNING = {
  maxConnections: "200",
  sharedBuffers: "256MB",
  tcpKeepalivesIdle: "60",
  tcpKeepalivesInterval: "10",
  tcpKeepalivesCount: "6",
  idleInTransactionSessionTimeout: "10min",
} as const;

export const POSTGRES_POOLER = {
  name: objectName("pgPoolerRw"),
  maxClientConn: "2000",
  maxPreparedStatements: "200",
  idleTransactionTimeout: "600",
  authConnections: 1,
  resources: {
    requests: { cpu: "100m", memory: "64Mi" },
    limits: { cpu: "1", memory: "256Mi" },
  },
} as const;

export const POOLED_POOLS = [
  { database: "jobs", login: "app" },
  { database: "checkpoints", login: "app" },
  { database: "app", login: "runtime" },
] as const;

export const POSTGRES_DIRECT_RESERVE = {
  superuser: 3,
  cnpg: 6,
  sseListen: 20,
  sessionLocksBackground: 4,
  bootstrapJobs: 6,
  langfuse: 20,
  filerPerReplica: 40,
} as const;

export const QDRANT = {
  name: "qdrant",
  headless: "qdrant-headless",
  secret: "qdrant-credentials", // pragma: allowlist secret (Kubernetes Secret resource name, not a credential)
  snapshotJob: "qdrant-snapshot",
  aliasesPrefix: "aliases/",
  alertRules: "qdrant-alert-rules",
  opsLabel: "qdrant-ops",
  dashboard: {
    routeName: objectName("qdrantDashboardRoute"),
    listenerName: "https-qdrant",
    tlsSecret: objectName("qdrantTls"), // pragma: allowlist secret (Kubernetes Secret resource name, not a credential)
    policyName: objectName("qdrantDashboardAuth"),
    oidcSecret: "qdrant-dashboard-oidc", // pragma: allowlist secret (Kubernetes Secret resource name, not a credential)
    path: "/dashboard",
  },
  snapshotBucket: "qdrant-snapshots",
  s3Identity: "grid-qdrant",
  tenantShards: 6,
  tenantReplicationFactor: 2,
  s3Region: "us-east-1",
  curlImage: "curlimages/curl:8.16.0",
} as const;
