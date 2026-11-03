/**
 * A CloudNativePG cluster's PITR archive (Barman to S3), read the same way for
 * every cluster: the application's (`pg*` keys) and the background-work one
 * Hatchet runs on (`backgroundWorkPg*` keys).
 */
import * as pulumi from "@pulumi/pulumi";
import { bool } from "./readers";

/**
 * Server-side-encryption modes CloudNativePG accepts on `barmanObjectStore`'s
 * `wal.encryption` / `data.encryption`. Mirrors the CRD enum exactly
 * (`Enum=AES256;"aws:kms"`): "off" is the absence of the key, not `""`, so it
 * has no member here.
 */
export type BarmanEncryption = "AES256" | "aws:kms";

export interface BarmanBackups {
  enabled: boolean;
  /** S3 endpoint Barman writes to. */
  endpoint: string;
  /** Override credentials for an external endpoint. */
  accessKey?: string;
  secretKey?: pulumi.Output<string>;
  /** Bucket for base backups + WAL. */
  bucket: string;
  /** Barman retention (e.g. "30d"). */
  retention: string;
  /** 6-field cron (CNPG uses seconds-first). */
  schedule: string;
  /**
   * **Server-side** encryption barman-cloud asks the destination for, on both
   * the WAL stream and the base backups. Undefined means the key is omitted and
   * the bucket's own policy decides. SSE only encrypts if the DESTINATION
   * implements it; the in-cluster SeaweedFS (3.80) does not, so the combination
   * is refused at load (see `cnpg.ts`).
   */
  encryption?: BarmanEncryption;
}

export interface BarmanDefaults {
  /** Key prefix: `pg` reads `pgBackupsEnabled`, `pgBackupEndpoint`, …. */
  prefix: string;
  /** Unset `<prefix>BackupEndpoint`: undefined makes the endpoint required once backups are on. */
  endpoint?: string;
  bucket: string;
  retention: string;
  schedule: string;
  /** What the archive holds, for the unencrypted-at-rest warning. */
  holds: string;
}

/** True for an endpoint that names the in-cluster SeaweedFS (`//seaweedfs` also catches the FQDN). */
export function isInClusterSeaweed(endpoint: string): boolean {
  return endpoint.includes("//seaweedfs") || endpoint.includes("seaweedfs:8333");
}

function readEncryption(cfg: pulumi.Config, key: string): BarmanEncryption | undefined {
  const raw = (cfg.get(key) ?? "").trim();
  if (raw === "") return undefined;
  if (!["AES256", "aws:kms"].includes(raw)) {
    // The CNPG webhook would reject this too, but only ~20 min into a `pulumi
    // up` that has already started mutating the cluster.
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
    // Refuse rather than warn. SeaweedFS 3.80 implements no SSE, answers 200
    // and stores the object unencrypted: the setting would claim an encryption
    // that does not exist.
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
  return {
    enabled,
    endpoint: endpoint ?? "",
    accessKey: cfg.get(key("BackupAccessKey")),
    secretKey: cfg.getSecret(key("BackupSecretKey")),
    bucket: cfg.get(key("BackupBucket")) ?? d.bucket,
    retention: cfg.get(key("BackupRetention")) ?? d.retention,
    schedule: cfg.get(key("BackupSchedule")) ?? d.schedule,
    encryption,
  };
}
