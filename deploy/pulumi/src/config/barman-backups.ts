import * as pulumi from "@pulumi/pulumi";
import { bool } from "./readers";

export type BarmanEncryption = "AES256" | "aws:kms";

export interface BarmanBackups {
  enabled: boolean;
  endpoint: string;
  accessKey?: string;
  secretKey?: pulumi.Output<string>;
  bucket: string;
  retention: string;
  schedule: string;
  encryption?: BarmanEncryption;
}

export interface BarmanDefaults {
  prefix: string;
  endpoint?: string;
  bucket: string;
  retention: string;
  schedule: string;
  holds: string;
}

export function isInClusterSeaweed(endpoint: string): boolean {
  return endpoint.includes("//seaweedfs") || endpoint.includes("seaweedfs:8333");
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// The in-cluster SeaweedFS pod restarted five times on 2026-11-02, on the same Delete-reclaim storage as the database it would restore.
export const PRODUCTION_STACK = "prod";

export function refuseInClusterAppArchive(
  cfg: pulumi.Config,
  app: BarmanBackups,
  where: { stack: string; seaweedPublicHost: string },
  externalPrefixes: string[] = ["backgroundWorkPg"],
): void {
  const onSeaweed = (endpoint: string) =>
    isInClusterSeaweed(endpoint) || hostOf(endpoint) === where.seaweedPublicHost.toLowerCase();
  if (where.stack !== PRODUCTION_STACK || !app.enabled || !onSeaweed(app.endpoint)) return;
  const external = externalPrefixes
    .map((prefix) => ({ prefix, endpoint: (cfg.get(`${prefix}BackupEndpoint`) ?? "").trim() }))
    .find(({ endpoint }) => endpoint !== "" && !onSeaweed(endpoint));
  if (!external) return;
  throw new Error(
    `The production app database archive (pgBackupEndpoint) points at the in-cluster SeaweedFS (${app.endpoint}), ` +
      `but this stack already archives off-cluster (${external.prefix}BackupEndpoint=${external.endpoint}). ` +
      "Set pgBackupEndpoint, pgBackupBucket, pgBackupAccessKey and pgBackupSecretKey to the external bucket " +
      "(docs/deployment/kubernetes.md, \"Moving the app archive off-cluster\").",
  );
}

function readEncryption(cfg: pulumi.Config, key: string): BarmanEncryption | undefined {
  const raw = (cfg.get(key) ?? "").trim();
  if (raw === "") return undefined;
  if (!["AES256", "aws:kms"].includes(raw)) {
    throw new Error(
      `${key} must be "AES256" or "aws:kms" (got "${raw}"). ` +
        "Leave it unset to inherit the bucket policy — CloudNativePG's enum has no empty member, " +
        "so \"off\" is the key being absent, not an empty string.",
    );
  }
  return raw as BarmanEncryption;
}

export function loadBarmanBackups(cfg: pulumi.Config, d: BarmanDefaults): BarmanBackups {
  const key = (suffix: string) => `${d.prefix}${suffix}`;
  const enabled = bool(cfg, key("BackupsEnabled"), false);
  const endpoint = cfg.get(key("BackupEndpoint")) ?? d.endpoint;
  const encryption = readEncryption(cfg, key("BackupEncryption"));
  if (endpoint === undefined) {
    if (enabled) {
      throw new Error(
        `${key("BackupsEnabled")} is true but ${key("BackupEndpoint")} is unset. This archive ` +
          "goes to object storage OUTSIDE the cluster: set the endpoint, bucket and " +
          `${key("BackupAccessKey")} / ${key("BackupSecretKey")}.`,
      );
    }
  } else if (encryption !== undefined && isInClusterSeaweed(endpoint)) {
    throw new Error(
      `${key("BackupEncryption")} is set but ${key("BackupEndpoint")} points at ` +
        `the in-cluster SeaweedFS (${endpoint}), which implements no server-side encryption ` +
        "(SSE-S3/KMS/C first appear in 3.97; prod pins 3.80, and this program configures no KMS for " +
        "them on any image). SeaweedFS answers such a request 200 and stores the object in the clear, " +
        `so the setting would claim an encryption that does not exist. Point ${key("BackupEndpoint")} at an ` +
        `external S3 destination that documents SSE support, or leave ${key("BackupEncryption")} unset.`,
    );
  }
  if (enabled && encryption === undefined) {
    pulumi.log.warn(
      `Postgres PITR archive (${key("Backups")}) is UNENCRYPTED at rest. WAL and base backups are a byte-for-byte ` +
        `copy of ${d.holds} and go to ${endpoint} with no encryption requested. On the in-cluster ` +
        "SeaweedFS there is no fix available in this program — SeaweedFS 3.80 has no SSE. For a " +
        `real guarantee use an external S3 destination and set ${key("BackupEncryption")}=AES256. ` +
        "See docs/deployment/kubernetes.md § Encryption posture.",
    );
  }
  const accessKey = cfg.get(key("BackupAccessKey"));
  const secretKey = cfg.getSecret(key("BackupSecretKey"));
  if (enabled && endpoint !== undefined && !isInClusterSeaweed(endpoint) && (!accessKey || !secretKey)) {
    throw new Error(
      `${key("BackupEndpoint")} points outside the cluster (${endpoint}) but ${key("BackupAccessKey")} / ` +
        `${key("BackupSecretKey")} are not both set. Set the bucket's own credentials (the secret one with --secret).`,
    );
  }
  return {
    enabled,
    endpoint: endpoint ?? "",
    accessKey,
    secretKey,
    bucket: cfg.get(key("BackupBucket")) ?? d.bucket,
    retention: cfg.get(key("BackupRetention")) ?? d.retention,
    schedule: cfg.get(key("BackupSchedule")) ?? d.schedule,
    encryption,
  };
}
