/**
 * Background work (ADR-0150): the self-hosted Hatchet control plane every
 * background job runs on (ingest, research runs, BFF jobs), the CloudNativePG
 * cluster `background-work-pg` that is its database, and the three-node
 * RabbitMQ that is its message queue (`platform/rabbitmq.ts`).
 *
 * Required in every stack, so nothing here turns it off. Its two credentials
 * default to one-way HMACs of `pgAppPassword` (like the scaler login's,
 * `config/postgres.ts`), so a stack needs no new secret to deploy it; set
 * either key to rotate it on its own.
 */
import * as pulumi from "@pulumi/pulumi";
import { type BarmanBackups, loadBarmanBackups } from "./barman-backups";
import { derivedScalerPassword } from "./postgres";
import { positiveInt } from "./readers";

export interface BackgroundWorkConfig {
  postgres: {
    /** CloudNativePG instances (`backgroundWorkPgInstances`): 2 = a primary and a replica. */
    instances: number;
    storageSize: string;
    resources: { requests: Record<string, string>; limits: Record<string, string> };
    /** Password of `hatchet`, the role that owns database `hatchet` (`backgroundWorkPgPassword`). */
    password: pulumi.Output<string>;
    /** Password of the read-only `keda_scaler` login on this cluster (`backgroundWorkPgScalerPassword`). */
    scalerPassword: pulumi.Output<string>;
    /**
     * The PITR archive (`backgroundWorkPgBackup*`), off by default. Unlike the
     * application cluster's, whose archive defaults to the in-cluster SeaweedFS,
     * this one has no default endpoint: it is meant for object storage OUTSIDE
     * the cluster, and enabling it without an endpoint fails the plan.
     */
    backups: BarmanBackups;
  };
  rabbitmq: {
    /** Each node's volume (`hatchetRabbitmqStorageSize`). */
    storageSize: string;
  };
  hatchet: {
    /** The `hatchet-ha` chart version (`hatchetChartVersion`). */
    chartVersion: string;
    /** Hatchet's image tag for every component (`hatchetImageTag`, the chart's `sharedConfig.image.tag`). */
    imageTag: string;
    /** The dashboard's seeded admin login (`hatchetAdminEmail`, `hatchetAdminPassword`). */
    adminEmail: string;
    adminPassword: pulumi.Output<string>;
  };
}

/**
 * Fixed decisions of the background-work platform: names the chart, the grants
 * Job, the KEDA triggers and the network policies agree on, and the numbers
 * the connection budget adds up (`backgroundWorkPgConnectionBudget`).
 */
export const BACKGROUND_WORK = {
  /** Its own namespace: the chart's setup Jobs add SYS_PTRACE and its Role writes Secrets (`platform/hatchet.ts`). */
  namespace: "background-work",
  cluster: "background-work-pg",
  database: "hatchet",
  owner: "hatchet",
  maxConnections: 260,
  sharedBuffers: "1GB",
  /**
   * `statement_timeout` of the `hatchet` role, set by the grants Job. Hatchet's
   * own statements take milliseconds; this bounds a runaway one. A migration
   * that needs longer is run by hand (docs/deployment/hatchet.md, "Upgrade").
   */
  statementTimeout: "5min",
  /** Replicas of each backend component of the `hatchet-ha` chart. */
  replicas: { api: 2, grpc: 2, controllers: 2, scheduler: 2 },
  /** `DATABASE_MAX_CONNS` of every Hatchet process (the engine's default is 50). */
  engineMaxConns: 15,
  /** The chart's per-deploy Jobs that open an engine pool: the migration and the worker token. */
  bootstrapProcesses: 2,
  /** Hatchet's run retention: 14 days, as a Go duration (`SERVER_LIMITS_DEFAULT_TENANT_RETENTION_PERIOD`). */
  retention: "336h",
} as const;

/** The chart release this program was written against: values checked in `hatchet-ha-0.21.0.tgz`. */
export const HATCHET_CHART_VERSION = "0.21.0";
/** That chart's own default image tag (`sharedConfig.image.tag`). */
export const HATCHET_IMAGE_TAG = "v0.114.2";

export function loadBackgroundWork(cfg: pulumi.Config): BackgroundWorkConfig {
  const appPassword = cfg.requireSecret("pgAppPassword");
  const cpu = cfg.get("backgroundWorkPgCpu") ?? "2";
  const memory = cfg.get("backgroundWorkPgMemory") ?? "4Gi";
  return {
    postgres: {
      instances: positiveInt(cfg, "backgroundWorkPgInstances", 2),
      storageSize: cfg.get("backgroundWorkPgStorageSize") ?? "20Gi",
      // Memory requested at its limit: a Postgres that is OOM-killed under
      // pressure fails over, which is worse than not being scheduled.
      resources: { requests: { cpu: "500m", memory }, limits: { cpu, memory } },
      password: cfg.getSecret("backgroundWorkPgPassword") ?? derivedScalerPassword(appPassword, "background-work-pg-hatchet"),
      scalerPassword:
        cfg.getSecret("backgroundWorkPgScalerPassword") ?? derivedScalerPassword(appPassword, "background-work-pg-keda-scaler"),
      backups: loadBarmanBackups(cfg, {
        prefix: "backgroundWorkPg",
        bucket: "background-work-pg-backups",
        // Hatchet keeps a run 14 days; two weeks of PITR covers every run it still holds.
        retention: "14d",
        schedule: "0 30 2 * * *",
        holds: "Hatchet's database (task inputs carry ids and already-encrypted payloads, never plaintext)",
      }),
    },
    rabbitmq: { storageSize: cfg.get("hatchetRabbitmqStorageSize") ?? "10Gi" },
    hatchet: {
      chartVersion: cfg.get("hatchetChartVersion") ?? HATCHET_CHART_VERSION,
      imageTag: cfg.get("hatchetImageTag") ?? HATCHET_IMAGE_TAG,
      adminEmail: cfg.get("hatchetAdminEmail") ?? cfg.require("letsEncryptEmail"),
      // The suffix meets a password rule of upper case, lower case and a digit
      // whatever the HMAC happens to yield.
      adminPassword:
        cfg.getSecret("hatchetAdminPassword") ??
        derivedScalerPassword(appPassword, "hatchet-admin").apply((p) => `${p}Aa1`),
    },
  };
}
