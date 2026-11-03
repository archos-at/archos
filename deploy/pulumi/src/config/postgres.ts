/**
 * PostgreSQL (CloudNativePG): instances, the pooler, credentials and the encrypted PITR archive.
 */
import * as pulumi from "@pulumi/pulumi";
import { createHmac } from "node:crypto";
import { num, positiveInt } from "./readers";
import { type BarmanBackups, loadBarmanBackups } from "./barman-backups";
export type { BarmanEncryption } from "./barman-backups";

/**
 * The scaler login's password when `pgScalerPassword` is not set: an HMAC of a
 * fixed label under the owner's password. One-way, so holding the scaler DSN
 * says nothing about `pgAppPassword` (Postgres authenticates by role AND
 * password, which is the whole reason `app_rw` has a password of its own),
 * and URL-safe, so it needs no care in a DSN. It follows `pgAppPassword` when
 * that rotates.
 */
export function derivedScalerPassword(appPassword: pulumi.Output<string>, label = "grid-keda-scaler"): pulumi.Output<string> {
  return pulumi.secret(
    appPassword.apply((password) => createHmac("sha256", password).update(label).digest("base64url")),
  );
}

export interface PostgresConfig {
  /** CloudNativePG instance count (1 = single primary; ≥2 = HA with replicas). */
  instances: number;
  /**
   * The transaction pooler in front of the pooled DSNs (ADR-0083). Its worst
   * case against `max_connections` is `pgConnectionBudget`, and the plan fails
   * when that does not fit.
   */
  pooler: {
    /** PgBouncer replicas (`pgPoolerInstances`). Each keeps its own server pool per (database, role). */
    instances: number;
    /**
     * Server connections one PgBouncer opens per (database, role) pair
     * (`pgPoolerPoolSize`, PgBouncer's `default_pool_size`). The default is 12,
     * the largest that lets a fresh stack with everything on pass the plan:
     * two poolers x (three pooled pairs x 12 + 1 auth session) = 74 of the
     * primary's 200 connections, against a direct reserve of up to 122 (62
     * fixed or sized by the ingest tier at 5 x 3, 20 for Langfuse, 40 for a
     * filer that keeps its namespace in Postgres) = 196. Prod, on the single
     * SeaweedFS topology and an ingest tier of 3 x 3, holds 74 + 76 = 150.
     * It is not a demand number: a transaction holds a server connection for milliseconds, and 24 per pair
     * across the two poolers serves hundreds of statements a second. Clients
     * past the pool queue in PgBouncer, which shows as `cl_waiting` rather than
     * as an error. Raise it only together with `max_connections`.
     */
    poolSize: number;
    /** Digest-pinned PgBouncer image (>= 1.21: protocol-level prepared statements). */
    image: string;
  };
  storageSize: string;
  /** App role name that owns the three databases. */
  appUser: string;
  /** App role password. Secret. Drives every DSN. */
  appPassword: pulumi.Output<string>;
  /**
   * Password for `app_rw`, the least-privilege role the app tier
   * connects as under row-level security (ADR-0041). REQUIRED, and
   * deliberately without a fallback to `pgAppPassword`.
   *
   * It used to default to the app password, on the reasoning that what bounds
   * this role is its PRIVILEGES — DML only, RLS enforced, no DDL — rather than
   * password distinctness. That reasoning is wrong: Postgres authenticates by
   * (role, password), so anyone holding the runtime DSN could present the same
   * password as `appUser`, the schema owner, who is exempt from every policy.
   * The privilege split is only worth what the credential split is worth.
   *
   * `pulumi config set --secret pgRuntimePassword <value>` on each stack; an
   * existing stack must set it (and rotate) before the next deploy.
   */
  runtimePassword: pulumi.Output<string>;
  /**
   * Password for `keda_scaler`, the read-only login KEDA's `postgresql`
   * scaler counts the queue tables with (ADR-0079). Optional
   * (`pgScalerPassword`): unset, it is derived from `pgAppPassword` by a
   * one-way HMAC, so it is never the owner's password and an existing stack
   * needs no new secret to deploy. Set it to rotate the scaler's credential
   * on its own.
   */
  scalerPassword: pulumi.Output<string>;
  /**
   * How CNPG rolls the primary during an operator/image update.
   * "unsupervised" = automatic switchover + restart (no human), which is what
   * you want on a provider that drains/replaces nodes automatically.
   */
  primaryUpdateStrategy: "unsupervised" | "supervised";
  /**
   * Continuous WAL archiving + scheduled base backups to SeaweedFS via CNPG's
   * Barman object-store integration — the only real defence against the
   * provider's `Delete` reclaim policy (a dropped PVC is otherwise
   * unrecoverable). Gives point-in-time recovery.
   */
  backups: BarmanBackups;
}

export function loadPostgres(cfg: pulumi.Config): PostgresConfig {
  // The archive is the single largest plaintext surface in the stack when it is
  // on: WAL + base backups are a byte-for-byte copy of all three databases.
  // Its default destination is the in-cluster SeaweedFS, which protects
  // against Postgres PVC loss but NOT against cluster deletion (it lives on the
  // same Delete-reclaim CSI). Point `pgBackupEndpoint` at an external S3 (with
  // `pgBackupAccessKey` / `pgBackupSecretKey`) for real offsite PITR.
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
      // Digest-pinned like the ADR-0029 and ADR-0044 images, and scanned by the
      // same trivy job in security.yml. The tag is the version (1.26.0, which
      // is >= 1.21: protocol-level prepared statements in transaction mode);
      // the digest is what the cluster pulls. CloudNativePG's own build of
      // PgBouncer, because the operator drives its config and its auth query.
      image:
        cfg.get("pgPoolerImage") ??
        "ghcr.io/cloudnative-pg/pgbouncer:1.26.0@sha256:ce54f1133c509f1db8a8092c3f1c761d8c9292065ed6b6698786bb966da4dab9",
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
