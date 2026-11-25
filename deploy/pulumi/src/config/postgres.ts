import * as pulumi from "@pulumi/pulumi";
import { createHmac } from "node:crypto";
import { num, positiveInt } from "./readers";
import { type BarmanBackups, loadBarmanBackups } from "./barman-backups";
export type { BarmanEncryption } from "./barman-backups";

export function derivedScalerPassword(appPassword: pulumi.Output<string>, label = "grid-keda-scaler"): pulumi.Output<string> {
  return pulumi.secret(
    appPassword.apply((password) => createHmac("sha256", password).update(label).digest("base64url")),
  );
}

export interface PostgresConfig {
  instances: number;
  pooler: {
    instances: number;
    poolSize: number;
    image: string;
  };
  storageSize: string;
  appUser: string;
  appPassword: pulumi.Output<string>;
  runtimePassword: pulumi.Output<string>;
  scalerPassword: pulumi.Output<string>;
  primaryUpdateStrategy: "unsupervised" | "supervised";
  backups: BarmanBackups;
}

export function loadPostgres(cfg: pulumi.Config): PostgresConfig {
  const backups = loadBarmanBackups(cfg, {
    prefix: "pg",
    endpoint: "http://seaweedfs:8333",
    bucket: "grid-pg-backups",
    retention: "30d",
    schedule: "0 0 2 * * *",
    holds: "all three databases (conversations, LangGraph checkpoints, the whole app schema)",
  });
  return {
    instances: num(cfg, "pgInstances", 1),
    pooler: {
      instances: positiveInt(cfg, "pgPoolerInstances", 2),
      poolSize: positiveInt(cfg, "pgPoolerPoolSize", 12),
      image:
        cfg.get("pgPoolerImage") ??
        "ghcr.io/cloudnative-pg/pgbouncer:1.26.1@sha256:9f648625e11f67f5171f1edd31648c7d02a1a4a5e1b8adf7d4a9db30dce8c22b",
    },
    storageSize: cfg.get("pgStorageSize") ?? "20Gi",
    appUser: cfg.get("pgAppUser") ?? "agent",
    appPassword: cfg.requireSecret("pgAppPassword"),
    runtimePassword: cfg.requireSecret("pgRuntimePassword"),
    scalerPassword: cfg.getSecret("pgScalerPassword") ?? derivedScalerPassword(cfg.requireSecret("pgAppPassword")),
    primaryUpdateStrategy:
      cfg.get("pgPrimaryUpdateStrategy") === "supervised" ? "supervised" : "unsupervised",
    backups,
  };
}
