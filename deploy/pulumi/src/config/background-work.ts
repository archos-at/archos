import * as pulumi from "@pulumi/pulumi";
import { type BarmanBackups, loadBarmanBackups } from "./barman-backups";
import { derivedScalerPassword } from "./postgres";
import { positiveInt } from "./readers";

export interface BackgroundWorkConfig {
  postgres: {
    instances: number;
    storageSize: string;
    resources: { requests: Record<string, string>; limits: Record<string, string> };
    password: pulumi.Output<string>;
    scalerPassword: pulumi.Output<string>;
    backups: BarmanBackups;
  };
  rabbitmq: {
    storageSize: string;
  };
  hatchet: {
    chartVersion: string;
    imageTag: string;
    adminEmail: string;
    adminPassword: pulumi.Output<string>;
  };
}

export const BACKGROUND_WORK = {
  namespace: "background-work",
  cluster: "background-work-pg",
  database: "hatchet",
  owner: "hatchet",
  maxConnections: 260,
  sharedBuffers: "1GB",
  statementTimeout: "5min",
  replicas: { api: 2, grpc: 2, controllers: 2, scheduler: 2 },
  engineMaxConns: 15,
  bootstrapProcesses: 2,
  retention: "336h",
} as const;

export const HATCHET_CHART_VERSION = "0.21.0";
export const HATCHET_IMAGE_TAG = "v0.114.2";

export function loadBackgroundWork(cfg: pulumi.Config): BackgroundWorkConfig {
  const appPassword = cfg.requireSecret("pgAppPassword");
  const cpu = cfg.get("backgroundWorkPgCpu") ?? "2";
  const memory = cfg.get("backgroundWorkPgMemory") ?? "4Gi";
  return {
    postgres: {
      instances: positiveInt(cfg, "backgroundWorkPgInstances", 2),
      storageSize: cfg.get("backgroundWorkPgStorageSize") ?? "20Gi",
      resources: { requests: { cpu: "500m", memory }, limits: { cpu, memory } },
      password: cfg.getSecret("backgroundWorkPgPassword") ?? derivedScalerPassword(appPassword, "background-work-pg-hatchet"),
      scalerPassword:
        cfg.getSecret("backgroundWorkPgScalerPassword") ?? derivedScalerPassword(appPassword, "background-work-pg-keda-scaler"),
      backups: loadBarmanBackups(cfg, {
        prefix: "backgroundWorkPg",
        bucket: "background-work-pg-backups",
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
      adminPassword:
        cfg.getSecret("hatchetAdminPassword") ??
        derivedScalerPassword(appPassword, "hatchet-admin").apply((p) => `${p}Aa1`),
    },
  };
}
