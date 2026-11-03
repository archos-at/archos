/**
 * `background-work-pg` (ADR-0150): the CloudNativePG cluster Hatchet keeps its
 * state AND its message queue in (`SERVER_MSGQUEUE_KIND=postgres`), apart from
 * the application's cluster so a backlog of background work never competes with
 * a person's request for the same primary, and so a bulk reindex cannot fill
 * the disk that holds every conversation.
 *
 * Built from the same `cnpgClusterSpec` as the application's cluster
 * (`cnpg.ts`), smaller: one database (`hatchet`), its owner (`hatchet`, with a
 * `CONNECTION LIMIT` from `backgroundWorkPgConnectionBudget`) and the read-only
 * `keda_scaler` login the worker tiers' ScaledObjects count Hatchet's backlog
 * through. No pooler: Hatchet's pgx pools are bounded per process
 * (`DATABASE_MAX_CONNS`) and the budget adds them up.
 *
 * BACKUPS. The application cluster's archive defaults to the in-cluster
 * SeaweedFS, which survives a lost Postgres volume but not a lost cluster. This
 * one has no in-cluster default: when `backgroundWorkPgBackupsEnabled` is on it
 * must name object storage outside the cluster (`config/background-work.ts`).
 */
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { BACKGROUND_WORK } from "../config/background-work";
import {
  assertBackgroundWorkPgConnectionBudget,
  backgroundWorkPgConnectionBudget,
} from "../config/pg-connection-budget";
import { commonLabels } from "../platform/namespaces";
import { hardenedJobSecurityContext } from "../platform/security";
import { onNodeGroup } from "../platform/scheduling";
import { BOOTSTRAP_JOB_RESOURCES, JOB_DEFAULTS, KEDA_SCALER_CONNECTION_LIMIT, KEDA_SCALER_ROLE, PORT } from "../constants";
import { cnpgClusterSpec, installBackupSecret, installCnpgScheduledBackup } from "./cnpg";

export interface BackgroundWorkPostgres {
  cluster: k8s.apiextensions.CustomResource;
  /** `postgresql://hatchet:…@background-work-pg-rw.background-work.svc.cluster.local:5432/hatchet?sslmode=require`. */
  ownerDsn: pulumi.Output<string>;
  /** The same host as the read-only scaler, for KEDA's operator in its own namespace. */
  scalerDsn: pulumi.Output<string>;
  /**
   * The Job that gives the scaler SELECT on the columns its count reads, once
   * Hatchet's migrations have made the tables. Every ScaledObject that counts
   * Hatchet's backlog waits for it.
   */
  grants: (dependsOn: pulumi.Resource[]) => k8s.batch.v1.Job;
}

/** The primary's Service, by FQDN: every client of this cluster is in another namespace or is KEDA. */
export const BACKGROUND_WORK_PG_HOST = `${BACKGROUND_WORK.cluster}-rw.${BACKGROUND_WORK.namespace}.svc.cluster.local`;

/**
 * The columns of Hatchet's tables the scaler count reads, and nothing else: a
 * task's `input` is a sealed payload, but the scaler has no reason to hold it.
 * Table and column names from Hatchet's schema at the pinned image tag
 * (`sql/schema/v1-core.sql`, v0.114.2): `v1_queue_item` holds a task waiting
 * for a worker slot, `v1_task_runtime` one a worker holds, and `v1_task` names
 * the action of a runtime row. A task held back by its organisation's
 * concurrency (`GROUP_ROUND_ROBIN`) is in neither, so it does not ask for a
 * replica that could not run it anyway.
 */
export const SCALER_COLUMNS = {
  v1_queue_item: ["action_id"],
  v1_task: ["id", "inserted_at", "action_id"],
  v1_task_runtime: ["task_id", "task_inserted_at"],
} as const;

/** The grants Job's SQL, as the owner: the role's statement timeout, then the scaler's column grants. */
export function backgroundWorkGrantsSql(): string {
  const grants = Object.entries(SCALER_COLUMNS).map(
    ([table, columns]) => `GRANT SELECT (${columns.join(", ")}) ON ${table} TO ${KEDA_SCALER_ROLE};`,
  );
  return [
    `ALTER ROLE ${BACKGROUND_WORK.owner} SET statement_timeout = '${BACKGROUND_WORK.statementTimeout}';`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${KEDA_SCALER_ROLE};`,
    ...grants,
    "",
  ].join("\n");
}

function dsn(user: string, password: pulumi.Output<string>): pulumi.Output<string> {
  return password.apply(
    (pw) =>
      `postgresql://${user}:${encodeURIComponent(pw)}@${BACKGROUND_WORK_PG_HOST}:${PORT.postgres}/` +
      `${BACKGROUND_WORK.database}?sslmode=require`,
  );
}

function basicAuth(logical: string, user: string, password: pulumi.Output<string>, provider: k8s.Provider) {
  return new k8s.core.v1.Secret(
    logical,
    {
      metadata: { name: logical, namespace: BACKGROUND_WORK.namespace },
      type: "kubernetes.io/basic-auth",
      stringData: { username: user, password },
    },
    { provider },
  );
}

export function installBackgroundWorkPostgres(
  cfg: DeployConfig,
  provider: k8s.Provider,
  /** The namespace, and the CNPG operator's webhook being ready (the app cluster). */
  dependsOn: pulumi.Resource[],
): BackgroundWorkPostgres {
  assertBackgroundWorkPgConnectionBudget();
  const pg = cfg.backgroundWork.postgres;
  const owner = basicAuth("background-work-pg-owner", BACKGROUND_WORK.owner, pg.password, provider);
  const scaler = basicAuth("background-work-pg-scaler", KEDA_SCALER_ROLE, pg.scalerPassword, provider);
  const backupSecretName = `${BACKGROUND_WORK.cluster}-backup-s3`; // pragma: allowlist secret
  const backupSecret =
    pg.backups.enabled && pg.backups.accessKey && pg.backups.secretKey
      ? installBackupSecret("background-work-pg-backup-s3", backupSecretName, BACKGROUND_WORK.namespace, provider, {
          accessKey: pg.backups.accessKey,
          secretKey: pg.backups.secretKey,
        })
      : undefined;
  if (pg.backups.enabled && !backupSecret) {
    throw new Error(
      "backgroundWorkPgBackupsEnabled needs backgroundWorkPgBackupAccessKey and " +
        "backgroundWorkPgBackupSecretKey: the archive goes to object storage outside the cluster.",
    );
  }

  const cluster = new k8s.apiextensions.CustomResource(
    BACKGROUND_WORK.cluster,
    {
      apiVersion: "postgresql.cnpg.io/v1",
      kind: "Cluster",
      metadata: { name: BACKGROUND_WORK.cluster, namespace: BACKGROUND_WORK.namespace, labels: commonLabels("postgres") },
      spec: cnpgClusterSpec({
        instances: pg.instances,
        storageSize: pg.storageSize,
        storageClass: cfg.storage.className,
        primaryUpdateStrategy: cfg.postgres.primaryUpdateStrategy,
        dataNodeGroup: cfg.nodeGroups.data,
        resources: pg.resources,
        parameters: {
          max_connections: String(BACKGROUND_WORK.maxConnections),
          shared_buffers: BACKGROUND_WORK.sharedBuffers,
        },
        bootstrap: { database: BACKGROUND_WORK.database, owner: BACKGROUND_WORK.owner, secret: owner.metadata.name },
        // The owner is managed too, for its CONNECTION LIMIT; the operator
        // keeps its password from the same Secret the bootstrap used.
        roles: [
          {
            name: BACKGROUND_WORK.owner,
            passwordSecret: owner.metadata.name,
            connectionLimit: backgroundWorkPgConnectionBudget().hatchetRole,
          },
          { name: KEDA_SCALER_ROLE, passwordSecret: scaler.metadata.name, connectionLimit: KEDA_SCALER_CONNECTION_LIMIT },
        ],
        enableSuperuserAccess: false,
        backups: pg.backups,
        backupSecretName,
      }),
    },
    {
      provider,
      dependsOn: [owner, scaler, ...(backupSecret ? [backupSecret] : []), ...dependsOn],
      // CloudNativePG owns the PVCs: deleting this CR drops every run in flight.
      protect: cfg.protectDataResources,
    },
  );

  if (pg.backups.enabled) {
    installCnpgScheduledBackup(
      "background-work-pg-scheduled-backup",
      { name: `${BACKGROUND_WORK.cluster}-nightly`, cluster: BACKGROUND_WORK.cluster, schedule: pg.backups.schedule },
      provider,
      BACKGROUND_WORK.namespace,
      [cluster],
    );
  }

  const ownerDsn = dsn(BACKGROUND_WORK.owner, pg.password);
  const grants = (deps: pulumi.Resource[]) => installGrantsJob(cfg, provider, ownerDsn, [cluster, ...deps]);
  return { cluster, ownerDsn, scalerDsn: dsn(KEDA_SCALER_ROLE, pg.scalerPassword), grants };
}

/**
 * Idempotent, after the Hatchet release (whose setup Job runs the migrations
 * that create the tables): waits for `v1_queue_item`, then applies
 * {@link backgroundWorkGrantsSql}. A missing table fails it (`ON_ERROR_STOP`).
 */
function installGrantsJob(
  cfg: DeployConfig,
  provider: k8s.Provider,
  ownerDsn: pulumi.Output<string>,
  dependsOn: pulumi.Resource[],
): k8s.batch.v1.Job {
  const labels = commonLabels("background-work-pg-grants");
  const namespace = BACKGROUND_WORK.namespace;
  const sql = new k8s.core.v1.ConfigMap(
    "background-work-pg-grants-sql",
    { metadata: { namespace, labels }, data: { "grants.sql": backgroundWorkGrantsSql() } },
    { provider, replaceOnChanges: ["data"] },
  );
  const secret = new k8s.core.v1.Secret(
    "background-work-pg-grants-dsn",
    { metadata: { namespace, labels }, stringData: { OWNER_DSN: ownerDsn } },
    { provider },
  );
  const script = [
    "echo 'waiting for the Hatchet schema…';",
    `until [ "$(psql "$OWNER_DSN" -tAc "SELECT to_regclass('public.v1_queue_item') IS NOT NULL")" = t ]; do sleep 5; done;`,
    'psql "$OWNER_DSN" -v ON_ERROR_STOP=1 -f /sql/grants.sql;',
    "echo 'background-work grants complete';",
  ].join(" ");
  return new k8s.batch.v1.Job(
    "background-work-pg-grants",
    {
      metadata: { namespace, labels },
      spec: {
        backoffLimit: JOB_DEFAULTS.backoffLimit,
        ttlSecondsAfterFinished: JOB_DEFAULTS.ttlSecondsAfterFinished,
        template: {
          metadata: { labels },
          spec: {
            enableServiceLinks: false,
            restartPolicy: "OnFailure",
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "psql",
                image: "postgres:17-alpine",
                securityContext: hardenedJobSecurityContext(),
                resources: BOOTSTRAP_JOB_RESOURCES,
                envFrom: [{ secretRef: { name: secret.metadata.name } }],
                command: ["/bin/sh", "-c"],
                args: [script],
                volumeMounts: [{ name: "sql", mountPath: "/sql" }],
              },
            ],
            volumes: [{ name: "sql", configMap: { name: sql.metadata.name } }],
          },
        },
      },
    },
    { provider, dependsOn: [sql, secret, ...dependsOn], customTimeouts: { create: "20m", update: "20m" } },
  );
}
