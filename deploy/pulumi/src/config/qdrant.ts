import * as pulumi from "@pulumi/pulumi";
import { QDRANT } from "../constants";
import {
  bool,
  percent,
  positiveInt,
  requireSecretsTogether,
} from "./readers";

export const QDRANT_LOW_MEMORY_MODES = ["no_resident", "no_populate"] as const;

export type QdrantLowMemoryMode = (typeof QDRANT_LOW_MEMORY_MODES)[number];

export const RETIRED_VECTOR_KEYS = [
  "chromaEnabled",
  "chromaImage",
  "chromaStorageSize",
  "qdrantEnabled",
  "vectorBackend",
] as const;

export function refuseRetiredVectorKeys(cfg: pulumi.Config): void {
  const set = RETIRED_VECTOR_KEYS.filter((key) => cfg.get(key) !== undefined);
  if (set.length === 0) return;
  throw new Error(
    `${set.map((k) => `grid-oib:${k}`).join(", ")} ${set.length === 1 ? "is" : "are"} retired: Qdrant is ` +
      "the only vector store and always deployed, and Chroma is gone (ADR-0115). Remove " +
      `${set.length === 1 ? "it" : "them"} with \`pulumi config rm\`. To move the old Chroma data, see ` +
      '`chromaMigration` (docs/deployment/qdrant-runbook.md, "Migrating from Chroma on Kubernetes").',
  );
}

export function loadChromaMigration(cfg: pulumi.Config): ChromaMigrationConfig {
  return {
    enabled: bool(cfg, "chromaMigration", false),
    scratchSize: cfg.get("chromaMigrationScratchSize") ?? "50Gi",
    timeoutMinutes: positiveInt(cfg, "chromaMigrationTimeoutMinutes", 40),
  };
}

export function loadQdrant(cfg: pulumi.Config, dashboard: QdrantConfig["dashboard"]): QdrantConfig {
  const replicas = positiveInt(cfg, "qdrantReplicas", 3);
  if (replicas === 2) {
    throw new Error(
      "grid-oib:qdrantReplicas=2 is refused: two Raft voters lose quorum when either fails, so the " +
        "cluster tolerates no more failures than one peer and has twice the ways to stop. Use 3, or 1 " +
        "on a small stack.",
    );
  }
  const retentionDays = positiveInt(cfg, "qdrantSnapshotRetentionDays", 7);
  const schedule = cfg.get("qdrantSnapshotSchedule") ?? "30 1 * * *";
  if (schedule.trim().split(/\s+/).length !== 5) {
    throw new Error(`grid-oib:qdrantSnapshotSchedule must be a 5-field cron expression (got "${schedule}").`);
  }
  assertQdrantSecrets(cfg);
  const quotas = {
    memoryPercent: percent(cfg, "qdrantQuotaMemoryPercent", 90),
    diskPercent: percent(cfg, "qdrantQuotaDiskPercent", 85),
  };
  const lowMemoryMode = cfg.get("qdrantLowMemoryMode")?.trim() || undefined;
  const knownMode = QDRANT_LOW_MEMORY_MODES.find((m) => m === lowMemoryMode);
  if (lowMemoryMode && !knownMode) {
    throw new Error(
      `grid-oib:qdrantLowMemoryMode must be one of ${QDRANT_LOW_MEMORY_MODES.join(", ")} (got "${lowMemoryMode}"); ` +
        "remove the key for Qdrant's default. An unknown value stops every peer at start.",
    );
  }
  return {
    image: cfg.get("qdrantImage") ?? "qdrant/qdrant:v1.19.2",
    replicas,
    cpu: cfg.get("qdrantCpu") ?? "4",
    memory: cfg.get("qdrantMemory") ?? "16Gi",
    storageSize: cfg.get("qdrantStorageSize") ?? "100Gi",
    apiKey: cfg.getSecret("qdrantApiKey") ?? pulumi.secret(""),
    readOnlyApiKey: cfg.getSecret("qdrantReadOnlyApiKey") ?? pulumi.secret(""),
    altApiKey: (cfg.get("qdrantAltApiKey") ?? "").trim() ? cfg.requireSecret("qdrantAltApiKey") : undefined,
    lowMemoryMode: knownMode,
    quotas,
    snapshots: {
      schedule,
      retentionDays,
      s3AccessKey: cfg.get("qdrantS3AccessKey") ?? QDRANT.s3Identity,
      s3SecretKey: cfg.getSecret("qdrantS3SecretKey") ?? pulumi.secret(""),
    },
    dashboard,
  };
}

function assertQdrantSecrets(cfg: pulumi.Config): void {
  requireSecretsTogether(
    cfg,
    ["qdrantApiKey", "qdrantReadOnlyApiKey", "qdrantS3SecretKey"],
    "(Qdrant is always deployed, and open-source Qdrant answers anyone without a key; " +
      "generate each with `openssl rand -base64 32`)",
  );
  const raw = (key: string) => (cfg.get(key) ?? "").trim();
  if (raw("qdrantApiKey") === raw("qdrantReadOnlyApiKey")) {
    throw new Error(
      "grid-oib:qdrantReadOnlyApiKey must differ from grid-oib:qdrantApiKey: a request carrying it would " +
        "match the read-write key, so every holder of the read-only key could write.",
    );
  }
  if (raw("qdrantAltApiKey") && raw("qdrantAltApiKey") === raw("qdrantReadOnlyApiKey")) {
    throw new Error(
      "grid-oib:qdrantAltApiKey must differ from grid-oib:qdrantReadOnlyApiKey: the peers accept it as a " +
        "read-write key, so every holder of the read-only key could write.",
    );
  }
  const s3Collides = [
    "seaweedfsSecretKey",
    "seaweedfsBackendReadSecretKey",
    "seaweedfsTenantAdminSecretKey",
    "langfuseS3SecretKey",
  ].find((other) => raw(other) === raw("qdrantS3SecretKey"));
  if (s3Collides) {
    throw new Error(
      `grid-oib:qdrantS3SecretKey must differ from grid-oib:${s3Collides}. SeaweedFS authenticates by key, ` +
        "so a shared secret gives the Qdrant snapshot identity that identity's bucket scope instead of " +
        "its own single bucket.",
    );
  }
}

export interface ChromaMigrationConfig {
  enabled: boolean;
  scratchSize: string;
  timeoutMinutes: number;
}

export interface QdrantConfig {
  image: string;
  replicas: number;
  cpu: string;
  memory: string;
  storageSize: string;
  apiKey: pulumi.Output<string>;
  readOnlyApiKey: pulumi.Output<string>;
  altApiKey: pulumi.Output<string> | undefined;
  lowMemoryMode: QdrantLowMemoryMode | undefined;
  quotas: {
    memoryPercent: number;
    diskPercent: number;
  };
  snapshots: {
    schedule: string;
    retentionDays: number;
    s3AccessKey: string;
    s3SecretKey: pulumi.Output<string>;
  };
  dashboard: {
    enabled: boolean;
    domain: string;
  };
}

export function loadQdrantDashboard(
  cfg: pulumi.Config,
  baseDomain: string,
  missingOidcDeps: string[],
): QdrantConfig["dashboard"] {
  const qdrantDashboardDomain = cfg.get("qdrantDashboardDomain") ?? `qdrant.${baseDomain}`;
  const qdrantDashboardFlag = bool(cfg, "qdrantDashboardEnabled", true);
  const qdrantDashboardAsked = cfg.get("qdrantDashboardEnabled") !== undefined;
  const missingDashboardGate = missingOidcDeps.map((k) => `grid-oib:${k}`).join(", ");
  if (qdrantDashboardFlag && qdrantDashboardAsked && missingOidcDeps.length > 0) {
    throw new Error(
      "grid-oib:qdrantDashboardEnabled needs the platform WorkOS Connect application its route is gated " +
        `by: missing ${missingDashboardGate}. Set them ` +
        "(docs/deployment/kubernetes.md §9), or set qdrantDashboardEnabled=false and port-forward instead.",
    );
  }
  const qdrantDashboardEnabled = qdrantDashboardFlag && missingOidcDeps.length === 0;
  if (qdrantDashboardFlag && !qdrantDashboardEnabled) {
    pulumi.log.warn(
      `Qdrant dashboard not served: missing ${missingDashboardGate}, the WorkOS application its ` +
        "route is gated by. Set them to serve it, or set grid-oib:qdrantDashboardEnabled=false to silence this.",
    );
  }
  return { enabled: qdrantDashboardEnabled, domain: qdrantDashboardDomain };
}
