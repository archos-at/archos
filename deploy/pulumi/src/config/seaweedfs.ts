import * as pulumi from "@pulumi/pulumi";
import { DATA_RESOURCES, LANGFUSE, QDRANT } from "../constants";
import { bool, num, requireSecretsTogether } from "./readers";

export const SEAWEED_FILER_DB = "seaweedfs_filer";

export interface SeaweedfsConfig {
  image: string;
  storageSize: string;
  growVolume: boolean;
  bucket: string;
  accessKey: string;
  secretKey: pulumi.Output<string>;
  topology: "single" | "split";
  masterReplicas: number;
  volumeReplicas: number;
  filerReplicas: number;
  masterStorageSize: string;
  filerStorageSize: string;
  volumeSizeLimitMB: number;
  volumeMaxCount: number;
  volumeMinFreeSpace: string;
  defaultReplication: string;
  filerStore: "postgres" | "leveldb";
  filerDatabase: string;
  filerDatabaseUser: string;
  filerDatabasePassword: pulumi.Output<string>;
  backendReadAccessKey: string;
  backendReadSecretKey: pulumi.Output<string>;
  perOrgBuckets: boolean;
  tenantBucketPrefix: string;
  tenantAdminAccessKey: string;
  tenantAdminSecretKey: pulumi.Output<string>;
  backup: {
    enabled: boolean;
    endpoint: string;
    bucket: string;
    region: string;
    accessKey: pulumi.Output<string>;
    secretKey: pulumi.Output<string>;
    metadataSchedule: string;
  };
  encryptVolumeData: boolean;
  singleMemory: { request: string; limit: string };
}

export function loadSeaweedfs(cfg: pulumi.Config): SeaweedfsConfig {
  const seaweedTopologyRaw = (cfg.get("seaweedfsTopology") ?? "split").trim();
  if (seaweedTopologyRaw !== "single" && seaweedTopologyRaw !== "split") {
    throw new Error(
      `grid-oib:seaweedfsTopology must be "single" or "split" (got "${seaweedTopologyRaw}").`,
    );
  }
  const seaweedTopology: "single" | "split" = seaweedTopologyRaw;
  const seaweedFilerStoreRaw = (cfg.get("seaweedfsFilerStore") ?? "postgres").trim();
  if (seaweedFilerStoreRaw !== "postgres" && seaweedFilerStoreRaw !== "leveldb") {
    throw new Error(
      `grid-oib:seaweedfsFilerStore must be "postgres" or "leveldb" (got "${seaweedFilerStoreRaw}").`,
    );
  }
  const seaweedFilerStore: "postgres" | "leveldb" = seaweedFilerStoreRaw;
  const seaweedMasterReplicas = num(cfg, "seaweedfsMasterReplicas", 1);
  const seaweedFilerReplicas = num(cfg, "seaweedfsFilerReplicas", 1);
  if (seaweedTopology === "split") {
    if (seaweedMasterReplicas < 1 || seaweedMasterReplicas % 2 === 0) {
      throw new Error(
        `grid-oib:seaweedfsMasterReplicas must be an odd number >= 1 (got ${seaweedMasterReplicas}). ` +
          "The masters form a Raft quorum, and an even count tolerates no more failures than " +
          "the odd number below it while adding a way to deadlock.",
      );
    }
    if (num(cfg, "seaweedfsVolumeReplicas", 1) < 1) {
      throw new Error("grid-oib:seaweedfsVolumeReplicas must be >= 1.");
    }
    if (seaweedFilerStore === "leveldb" && seaweedFilerReplicas > 1) {
      throw new Error(
        `grid-oib:seaweedfsFilerReplicas is ${seaweedFilerReplicas} with the embedded leveldb ` +
          "filer store. Each replica would keep its own private namespace on its own PVC, so " +
          "the same object would exist or not depending on which pod answered. Use " +
          'seaweedfsFilerStore="postgres" to run more than one filer.',
      );
    }
    if (seaweedFilerReplicas < 1) {
      throw new Error("grid-oib:seaweedfsFilerReplicas must be >= 1.");
    }
    if (seaweedFilerStore === "postgres" && cfg.getSecret("seaweedfsFilerDbPassword") === undefined) {
      throw new Error(
        "grid-oib:seaweedfsFilerDbPassword is required when seaweedfsFilerStore is \"postgres\". " +
          "It is the login for the dedicated Postgres role that owns the filer namespace — " +
          'set it with `pulumi config set --secret grid-oib:seaweedfsFilerDbPassword "$(openssl rand -base64 24)"`.',
      );
    }
  } else {
    if (seaweedMasterReplicas !== 1 || num(cfg, "seaweedfsVolumeReplicas", 1) !== 1 || seaweedFilerReplicas !== 1) {
      pulumi.log.warn(
        'grid-oib:seaweedfsTopology is "single", so seaweedfsMasterReplicas / ' +
          "seaweedfsVolumeReplicas / seaweedfsFilerReplicas are ignored — the single-node " +
          'topology is one process on one PVC. Set seaweedfsTopology="split" to scale it.',
      );
    }
  }
  const seaweedVolumeSizeLimitMB = num(cfg, "seaweedfsVolumeSizeLimitMB", 1024);
  if (seaweedVolumeSizeLimitMB < 1 || seaweedVolumeSizeLimitMB > 30000) {
    throw new Error(
      `grid-oib:seaweedfsVolumeSizeLimitMB must be between 1 and 30000 (got ${seaweedVolumeSizeLimitMB}).`,
    );
  }
  {
    const minFree = cfg.get("seaweedfsVolumeMinFreeSpace") ?? "2GiB";
    const match = /^(\d+(?:\.\d+)?)\s*(GiB|GB|MiB|MB)$/i.exec(minFree.trim());
    if (match) {
      const value = Number(match[1]);
      const unit = match[2].toUpperCase();
      const mib = unit.startsWith("G") ? value * 1024 : value;
      if (mib < seaweedVolumeSizeLimitMB) {
        throw new Error(
          `grid-oib:seaweedfsVolumeMinFreeSpace (${minFree}) is smaller than one volume ` +
            `(seaweedfsVolumeSizeLimitMB=${seaweedVolumeSizeLimitMB}MB). The read-only brake would ` +
            "engage only after a volume had already run the disk out mid-write.",
        );
      }
    }
  }
  const seaweedReplication = (cfg.get("seaweedfsDefaultReplication") ?? "000").trim();
  if (!/^[0-9]{3}$/.test(seaweedReplication)) {
    throw new Error(
      `grid-oib:seaweedfsDefaultReplication must be three digits, ` +
        `<diffDataCenter><diffRack><sameRack> (got "${seaweedReplication}").`,
    );
  }
  {
    const copies =
      Number(seaweedReplication[0]) + Number(seaweedReplication[1]) + Number(seaweedReplication[2]) + 1;
    const volumeReplicas = num(cfg, "seaweedfsVolumeReplicas", 1);
    if (seaweedTopology === "split" && copies > volumeReplicas) {
      throw new Error(
        `grid-oib:seaweedfsDefaultReplication "${seaweedReplication}" asks for ${copies} copies but ` +
          `seaweedfsVolumeReplicas is ${volumeReplicas}. Volume growth would fail once the first ` +
          "volume fills, which looks like uploads spontaneously breaking rather than a config error.",
      );
    }
    if (seaweedTopology === "single" && copies > 1) {
      throw new Error(
        `grid-oib:seaweedfsDefaultReplication "${seaweedReplication}" asks for ${copies} copies, but ` +
          'seaweedfsTopology="single" runs exactly one volume server. Use "000".',
      );
    }
  }
  const seaweedPerOrgBuckets = bool(cfg, "seaweedfsPerOrgBuckets", false);
  const seaweedTenantPrefix = (cfg.get("seaweedfsTenantBucketPrefix") ?? "grid-org-").trim();
  if (!/^[a-z0-9][a-z0-9-]*-$/.test(seaweedTenantPrefix)) {
    throw new Error(
      `grid-oib:seaweedfsTenantBucketPrefix must be lowercase alphanumeric/hyphen, start with a ` +
        `letter or digit, and end with "-" (got "${seaweedTenantPrefix}").`,
    );
  }
  if (seaweedTenantPrefix.length > 32) {
    throw new Error(
      `grid-oib:seaweedfsTenantBucketPrefix is ${seaweedTenantPrefix.length} chars. S3 caps a ` +
        "bucket name at 63, and the organization id plus a collision-proof hash needs the rest.",
    );
  }
  if (seaweedTenantPrefix.startsWith("xn--")) {
    throw new Error(
      `grid-oib:seaweedfsTenantBucketPrefix must not start with "xn--" (got "${seaweedTenantPrefix}") — ` +
        "S3 reserves that prefix and SeaweedFS rejects such a bucket name outright.",
    );
  }
  {
    const platformBuckets = [
      cfg.get("seaweedfsBucket") ?? "grid-documents",
      cfg.get("pgBackupBucket") ?? "grid-pg-backups",
      cfg.get("seaweedfsBackupBucket") ?? "grid-documents-backup",
      LANGFUSE.bucket,
      QDRANT.snapshotBucket,
    ];
    for (const bucket of platformBuckets) {
      if (bucket.startsWith(seaweedTenantPrefix)) {
        throw new Error(
          `grid-oib:seaweedfsTenantBucketPrefix "${seaweedTenantPrefix}" is a prefix of the platform ` +
            `bucket "${bucket}". Tenant grants are wildcard-scoped (\`Read:${seaweedTenantPrefix}*\`) and ` +
            "match by string prefix, so this would hand that bucket to every identity holding a " +
            "tenant scope — including the read-only agent credential.",
        );
      }
    }
  }
  if (seaweedPerOrgBuckets && cfg.getSecret("seaweedfsTenantAdminSecretKey") === undefined) {
    throw new Error(
      "grid-oib:seaweedfsTenantAdminSecretKey is required when seaweedfsPerOrgBuckets is true. " +
        "It is the credential for the only identity allowed to create and drop tenant buckets — " +
        'set it with `pulumi config set --secret grid-oib:seaweedfsTenantAdminSecretKey "$(openssl rand -base64 24)"`.',
    );
  }
  const seaweedBackupEnabled = cfg.getBoolean("seaweedfsBackupEnabled") ?? false;
  if (seaweedBackupEnabled) {
    const backupEndpoint = cfg.get("seaweedfsBackupEndpoint") ?? "";
    if (!backupEndpoint) {
      throw new Error(
        "grid-oib:seaweedfsBackupEndpoint is required when seaweedfsBackupEnabled is true. " +
          "Point it at an EXTERNAL S3 endpoint — an in-cluster target does not survive the " +
          "cluster loss the backup exists to cover.",
      );
    }
    if (!backupEndpoint.startsWith("https://")) {
      throw new Error(
        `grid-oib:seaweedfsBackupEndpoint must be https:// (got ${backupEndpoint}). ` +
          "The mirror ships every document plus a long-lived S3 credential; over plaintext " +
          "HTTP both are readable by anyone on the path.",
      );
    }
    if (backupEndpoint.includes("seaweedfs:8333") || backupEndpoint.includes("//seaweedfs")) {
      throw new Error(
        `grid-oib:seaweedfsBackupEndpoint points at the in-cluster SeaweedFS (${backupEndpoint}). ` +
          "That stores the backup on the same volumes as the data. Use an external S3 endpoint.",
      );
    }
    requireSecretsTogether(
      cfg,
      ["seaweedfsBackupAccessKey", "seaweedfsBackupSecretKey"],
      "when seaweedfsBackupEnabled is true",
    );
  }
  const seaweedEncrypt = cfg.getBoolean("seaweedfsEncryptVolumeData") ?? true;
  if (seaweedEncrypt && !seaweedBackupEnabled) {
    pulumi.log.warn(
      "SeaweedFS volume encryption is ON but seaweedfsBackupEnabled is false. Chunk keys live in " +
        "the filer metadata store, so losing it makes every encrypted object unrecoverable — " +
        "there is no master key and no escrow. Enable the backup (ADR-0042) before storing " +
        "anything you cannot afford to lose, or set seaweedfsEncryptVolumeData=false.",
    );
  }
  if (
    seaweedEncrypt &&
    (seaweedTopology === "single" || seaweedFilerStore === "leveldb")
  ) {
    pulumi.log.warn(
      "SeaweedFS volume encryption is ON, but the filer store shares a cluster (and under " +
        'seaweedfsTopology="single", the same PVC) with the volume data it encrypts. Anyone who ' +
        "can read the volume files can read the keys beside them, so this is not disk-theft " +
        'protection yet — it buys crypto-erasure only. seaweedfsTopology="split" with ' +
        'seaweedfsFilerStore="postgres" is what separates the two (ADR-0043).',
    );
  }
      return {
    image: cfg.get("seaweedfsImage") ?? "chrislusf/seaweedfs:4.54",
    storageSize: cfg.get("seaweedfsStorageSize") ?? "20Gi",
    growVolume: bool(cfg, "seaweedfsGrowVolume", false),
    bucket: cfg.get("seaweedfsBucket") ?? "grid-documents",
    accessKey: cfg.get("seaweedfsAccessKey") ?? "grid",
    secretKey: cfg.requireSecret("seaweedfsSecretKey"),
    backendReadAccessKey: cfg.get("seaweedfsBackendReadAccessKey") ?? "grid-backend-read",
    backendReadSecretKey: cfg.requireSecret("seaweedfsBackendReadSecretKey"),
    perOrgBuckets: seaweedPerOrgBuckets,
    tenantBucketPrefix: seaweedTenantPrefix,
    tenantAdminAccessKey: cfg.get("seaweedfsTenantAdminAccessKey") ?? "grid-tenant-admin",
    tenantAdminSecretKey: cfg.getSecret("seaweedfsTenantAdminSecretKey") ?? pulumi.secret(""),
    topology: seaweedTopology,
    masterReplicas: seaweedMasterReplicas,
    volumeReplicas: num(cfg, "seaweedfsVolumeReplicas", 1),
    filerReplicas: seaweedFilerReplicas,
    masterStorageSize: cfg.get("seaweedfsMasterStorageSize") ?? "1Gi",
    filerStorageSize: cfg.get("seaweedfsFilerStorageSize") ?? "10Gi",
    volumeSizeLimitMB: seaweedVolumeSizeLimitMB,
    volumeMaxCount: num(cfg, "seaweedfsVolumeMaxCount", 64),
    volumeMinFreeSpace: cfg.get("seaweedfsVolumeMinFreeSpace") ?? "2GiB",
    defaultReplication: seaweedReplication,
    filerStore: seaweedFilerStore,
    filerDatabase: SEAWEED_FILER_DB,
    filerDatabaseUser: SEAWEED_FILER_DB,
    filerDatabasePassword:
      cfg.getSecret("seaweedfsFilerDbPassword") ?? pulumi.secret(""),
    backup: {
      enabled: cfg.getBoolean("seaweedfsBackupEnabled") ?? false,
      endpoint: cfg.get("seaweedfsBackupEndpoint") ?? "",
      bucket: cfg.get("seaweedfsBackupBucket") ?? "grid-documents-backup",
      region: cfg.get("seaweedfsBackupRegion") ?? "us-east-1",
      accessKey: cfg.getSecret("seaweedfsBackupAccessKey") ?? pulumi.secret(""),
      secretKey: cfg.getSecret("seaweedfsBackupSecretKey") ?? pulumi.secret(""),
      metadataSchedule: cfg.get("seaweedfsMetaSnapshotSchedule") ?? "0 3 * * *",
    },
    encryptVolumeData: cfg.getBoolean("seaweedfsEncryptVolumeData") ?? true,
    singleMemory: {
      request: cfg.get("seaweedfsSingleRequestsMemory") ?? DATA_RESOURCES.seaweedfs.requests.memory,
      limit: cfg.get("seaweedfsSingleLimitsMemory") ?? DATA_RESOURCES.seaweedfs.limits.memory,
    },
  };
}
