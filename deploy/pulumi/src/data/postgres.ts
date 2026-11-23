import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { assertPgConnectionBudget } from '../config/pg-connection-budget'
import { commonLabels } from "../platform/namespaces";
import { installPdb, onNodeGroup, spreadAcrossNodes } from "../platform/scheduling";
import { hardenedJobSecurityContext } from "../platform/security";
import { scrapeAnnotations } from "../platform/scrape";
import { cnpgClusterSpec, installBackupSecret, installCnpgScheduledBackup } from "./cnpg";
import { APP_DB, CHECKPOINTS_DB, JOBS_DB, RUNTIME_ROLE, installPostgresRename, installRlsRoleRename } from "./postgres-rename";
export { APP_DB, CHECKPOINTS_DB, JOBS_DB, RUNTIME_ROLE };
import { CHECKPOINTS_SQL, JOBS_SQL, seaweedFilerSql } from "./postgres-sql";
import {
  BOOTSTRAP_JOB_RESOURCES,
  DATA_RESOURCES,
  JOB_DEFAULTS,
  KEDA_SCALER_ROLE,
  LANGFUSE,
  PLATFORM_RESOURCES,
  PORT,
  POSTGRES_POOLER,
  POSTGRES_TUNING,
  HELM_RELEASE_TIMEOUT_SECONDS,
} from "../constants";
import { logicalName, objectName } from "../names";
import { scaledCpuRequest } from "../config/cpu-requests";

export type PgRoute = "pooler" | "direct";

export interface PgDsnOptions {
  db: string;
  via: PgRoute;
  driver?: string;
  as?: { user: string; password: pulumi.Output<string> };
  clusterWide?: boolean;
}

export interface Postgres {
  operator: k8s.helm.v3.Release;
  cluster: k8s.apiextensions.CustomResource;
  initJob: k8s.batch.v1.Job;
  renameRlsRoles: (dependsOn: pulumi.Resource[]) => k8s.batch.v1.Job;
  pooler: k8s.apiextensions.CustomResource;
  rwHost: string;
  dsn: (opts: PgDsnOptions) => pulumi.Output<string>;
  filerStoreDeps: pulumi.Resource[];
  langfuseDsn?: pulumi.Output<string>;
  langfuseStoreDeps: pulumi.Resource[];
}

export const CLUSTER_NAME = objectName("pgCluster");

export const CNPG_CHART_VERSION = "0.29.2";

export const CNPG_OPERATOR_VERSION = "1.30.2";

export const CNPG_OPERATOR_CONFIG = { ENABLE_INSTANCE_MANAGER_INPLACE_UPDATES: "true" } as const;

export function sslParamFor(driver: string): "ssl" | "sslmode" {
  return driver.includes("asyncpg") ? "ssl" : "sslmode";
}

export function installPostgres(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  backupDeps: pulumi.Resource[] = [],
): Postgres {
  assertPgConnectionBudget(cfg);

  const opNs = new k8s.core.v1.Namespace(
    "cnpg-system-ns",
    { metadata: { name: "cnpg-system" } },
    { provider },
  );

  const operator = new k8s.helm.v3.Release(
    "cloudnative-pg",
    {
      chart: "cloudnative-pg",
      version: CNPG_CHART_VERSION,
      timeout: HELM_RELEASE_TIMEOUT_SECONDS,
      namespace: opNs.metadata.name,
      repositoryOpts: { repo: "https://cloudnative-pg.github.io/charts" },
      values: { resources: scaledCpuRequest(PLATFORM_RESOURCES.cnpgOperator), config: { data: CNPG_OPERATOR_CONFIG } },
    },
    { provider, dependsOn: opNs },
  );

  const webhookReady = new k8s.batch.v1.Job(
    "cnpg-webhook-wait",
    {
      metadata: { namespace: opNs.metadata.name },
      spec: {
        backoffLimit: 30,
        ttlSecondsAfterFinished: 120,
        template: {
          spec: {
            restartPolicy: "OnFailure",
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "wait",
                image: "curlimages/curl:latest",
                securityContext: hardenedJobSecurityContext(),
                resources: scaledCpuRequest(BOOTSTRAP_JOB_RESOURCES),
                command: ["/bin/sh", "-c"],
                args: [
                  "echo 'waiting for cnpg webhook…'; " +
                    "until curl -sk -o /dev/null --max-time 5 " +
                    "https://cnpg-webhook-service.cnpg-system.svc:443/readyz; do sleep 3; done; " +
                    "echo 'cnpg webhook is serving'",
                ],
              },
            ],
          },
        },
      },
    },
    { provider, dependsOn: operator },
  );

  const appSecret = new k8s.core.v1.Secret(
    "pg-app-credentials",
    {
      metadata: { name: `${CLUSTER_NAME}-app-credentials`, namespace },
      type: "kubernetes.io/basic-auth",
      stringData: {
        username: cfg.postgres.appUser,
        password: cfg.postgres.appPassword,
      },
    },
    { provider },
  );

  const runtimeCredentials = new k8s.core.v1.Secret(
    "pg-runtime-credentials",
    {
      metadata: { name: `${CLUSTER_NAME}-runtime-credentials`, namespace },
      type: "kubernetes.io/basic-auth",
      stringData: {
        username: RUNTIME_ROLE,
        password: cfg.postgres.runtimePassword,
      },
    },
    { provider },
  );

  const scalerCredentials = new k8s.core.v1.Secret(
    "pg-keda-scaler-credentials",
    {
      metadata: { name: `${CLUSTER_NAME}-keda-scaler-credentials`, namespace },
      type: "kubernetes.io/basic-auth",
      stringData: { username: KEDA_SCALER_ROLE, password: cfg.postgres.scalerPassword },
    },
    { provider },
  );

  const filerStoreEnabled =
    cfg.seaweedfs.topology === "split" && cfg.seaweedfs.filerStore === "postgres";

  const filerCredentials = filerStoreEnabled
    ? new k8s.core.v1.Secret(
        "pg-seaweedfs-filer-credentials",
        {
          metadata: { name: `${CLUSTER_NAME}-seaweedfs-filer-credentials`, namespace },
          type: "kubernetes.io/basic-auth",
          stringData: {
            username: cfg.seaweedfs.filerDatabaseUser,
            password: cfg.seaweedfs.filerDatabasePassword,
          },
        },
        { provider },
      )
    : undefined;

  const langfuseCredentials = cfg.langfuse.enabled
    ? new k8s.core.v1.Secret(
        "pg-langfuse-credentials",
        {
          metadata: { name: `${CLUSTER_NAME}-langfuse-credentials`, namespace },
          type: "kubernetes.io/basic-auth",
          stringData: {
            username: LANGFUSE.databaseUser,
            password: cfg.langfuse.databasePassword,
          },
        },
        { provider },
      )
    : undefined;

  const backupSecretName = objectName("pgBackupSecret"); // pragma: allowlist secret
  const backupSecret = cfg.postgres.backups.enabled
    ? installBackupSecret("pg-backup-s3", backupSecretName, namespace, provider, {
        accessKey: cfg.postgres.backups.accessKey ?? cfg.seaweedfs.accessKey,
        secretKey: cfg.postgres.backups.secretKey ?? cfg.seaweedfs.secretKey,
      })
    : undefined;

  const cluster = new k8s.apiextensions.CustomResource(
    logicalName("grid-pg"),
    {
      apiVersion: "postgresql.cnpg.io/v1",
      kind: "Cluster",
      metadata: { name: CLUSTER_NAME, namespace, labels: commonLabels("postgres") },
      spec: cnpgClusterSpec({
        instances: cfg.postgres.instances,
        storageSize: cfg.postgres.storageSize,
        storageClass: cfg.storage.className,
        primaryUpdateStrategy: cfg.postgres.primaryUpdateStrategy,
        dataNodeGroup: cfg.nodeGroups.data,
        resources: DATA_RESOURCES.postgres,
        parameters: { max_connections: POSTGRES_TUNING.maxConnections, shared_buffers: POSTGRES_TUNING.sharedBuffers },
        bootstrap: {
          database: JOBS_DB,
          owner: cfg.postgres.appUser,
          secret: appSecret.metadata.name,
          postInitSQL: [
            `CREATE DATABASE ${CHECKPOINTS_DB} OWNER ${cfg.postgres.appUser}`,
            `CREATE DATABASE ${APP_DB} OWNER ${cfg.postgres.appUser}`,
          ],
        },
        roles: [
          ...(filerCredentials
            ? [{ name: cfg.seaweedfs.filerDatabaseUser, passwordSecret: filerCredentials.metadata.apply((m) => m!.name!) }]
            : []),
          ...(langfuseCredentials
            ? [{ name: LANGFUSE.databaseUser, passwordSecret: langfuseCredentials.metadata.apply((m) => m!.name!) }]
            : []),
        ],
        enableSuperuserAccess: true,
        backups: cfg.postgres.backups,
        backupSecretName,
      }),
    },
    {
      provider,
      dependsOn: [operator, webhookReady, ...(backupSecret ? [backupSecret] : []), ...backupDeps],
      protect: cfg.protectDataResources,
    },
  );

  const rwHost = `${CLUSTER_NAME}-rw`;

  const poolerLabels = commonLabels("pgbouncer");
  const poolerPods = { "cnpg.io/poolerName": POSTGRES_POOLER.name };
  const pooler = new k8s.apiextensions.CustomResource(
    logicalName("grid-pg-pooler-rw"),
    {
      apiVersion: "postgresql.cnpg.io/v1",
      kind: "Pooler",
      metadata: { name: POSTGRES_POOLER.name, namespace, labels: poolerLabels },
      spec: {
        cluster: { name: CLUSTER_NAME },
        instances: cfg.postgres.pooler.instances,
        type: "rw",
        pgbouncer: {
          poolMode: "transaction",
          parameters: {
            max_client_conn: POSTGRES_POOLER.maxClientConn,
            default_pool_size: String(cfg.postgres.pooler.poolSize),
            max_prepared_statements: POSTGRES_POOLER.maxPreparedStatements,
            idle_transaction_timeout: POSTGRES_POOLER.idleTransactionTimeout,
          },
        },
        template: {
          metadata: { labels: poolerLabels, annotations: scrapeAnnotations(PORT.poolerMetrics) },
          spec: {
            ...(cfg.postgres.pooler.instances > 1
              ? { topologySpreadConstraints: spreadAcrossNodes(poolerPods, Boolean(cfg.nodeGroups.data)) }
              : {}),
            ...onNodeGroup(cfg.nodeGroups.data),
            containers: [
              {
                name: "pgbouncer",
                image: cfg.postgres.pooler.image,
                resources: scaledCpuRequest(POSTGRES_POOLER.resources),
              },
            ],
          },
        },
      },
    },
    { provider, dependsOn: [cluster] },
  );
  if (cfg.postgres.pooler.instances > 1) {
    installPdb(POSTGRES_POOLER.name, namespace, provider, poolerPods, [pooler]);
  }

  const filerDatabase = filerCredentials
    ? new k8s.apiextensions.CustomResource(
        "pg-seaweedfs-filer-db",
        {
          apiVersion: "postgresql.cnpg.io/v1",
          kind: "Database",
          metadata: {
            name: cfg.seaweedfs.filerDatabase.replace(/_/g, "-"),
            namespace,
            labels: commonLabels("postgres"),
          },
          spec: {
            cluster: { name: CLUSTER_NAME },
            name: cfg.seaweedfs.filerDatabase,
            owner: cfg.seaweedfs.filerDatabaseUser,
            ensure: "present",
            databaseReclaimPolicy: "retain",
          },
        },
        { provider, dependsOn: [cluster], protect: cfg.protectDataResources },
      )
    : undefined;

  const langfuseDatabase = langfuseCredentials
    ? new k8s.apiextensions.CustomResource(
        "pg-langfuse-db",
        {
          apiVersion: "postgresql.cnpg.io/v1",
          kind: "Database",
          metadata: {
            name: LANGFUSE.database.replace(/_/g, "-"),
            namespace,
            labels: commonLabels("postgres"),
          },
          spec: {
            cluster: { name: CLUSTER_NAME },
            name: LANGFUSE.database,
            owner: LANGFUSE.databaseUser,
            ensure: "present",
            databaseReclaimPolicy: "retain",
          },
        },
        { provider, dependsOn: [cluster], protect: cfg.protectDataResources },
      )
    : undefined;

  const appUser = encodeURIComponent(cfg.postgres.appUser);
  const dsn = (opts: PgDsnOptions): pulumi.Output<string> => {
    const scheme = opts.driver ?? "postgresql";
    const service = opts.via === "pooler" ? POSTGRES_POOLER.name : rwHost;
    const user = opts.as ? encodeURIComponent(opts.as.user) : appUser;
    const password = opts.as ? opts.as.password : cfg.postgres.appPassword;
    const sslParam = sslParamFor(scheme);
    return pulumi.all([password, namespace]).apply(([pw, ns]) => {
      const host = opts.clusterWide ? `${service}.${ns}.svc.cluster.local` : service;
      return (
        `${scheme}://${user}:${encodeURIComponent(pw)}@${host}:${PORT.postgres}/${opts.db}` +
        `?${sslParam}=require`
      );
    });
  };

  const initSqlCm = new k8s.core.v1.ConfigMap(
    "pg-init-sql",
    {
      metadata: { namespace },
      data: {
        "jobs.sql": JOBS_SQL,
        "checkpoints.sql": CHECKPOINTS_SQL,
        ...(filerCredentials
          ? { "seaweedfs-filer.sql": seaweedFilerSql(cfg.seaweedfs.filerDatabase) }
          : {}),
      },
    },
    { provider, replaceOnChanges: ["data"] },
  );

  const initDsnSecret = new k8s.core.v1.Secret(
    "pg-init-dsns",
    {
      metadata: { namespace },
      stringData: {
        JOBS_DSN: dsn({ db: JOBS_DB, via: "direct" }),
        CHECKPOINTS_DSN: dsn({ db: CHECKPOINTS_DB, via: "direct" }),
        ...(filerCredentials
          ? {
              SEAWEED_FILER_DSN: dsn({
                db: cfg.seaweedfs.filerDatabase,
                via: "direct",
                as: {
                  user: cfg.seaweedfs.filerDatabaseUser,
                  password: cfg.seaweedfs.filerDatabasePassword,
                },
              }),
            }
          : {}),
      },
    },
    { provider },
  );

  const renameWiring = {
    rwHost,
    superuserSecret: `${CLUSTER_NAME}-superuser`,
    appSecret: appSecret.metadata.name,
    runtimeSecret: runtimeCredentials.metadata.name,
    scalerSecret: scalerCredentials.metadata.name,
    passwords: { runtime: cfg.postgres.runtimePassword, scaler: cfg.postgres.scalerPassword },
  };
  const { job: renameJob, script: renameScript } = installPostgresRename(cfg, provider, namespace, renameWiring, [
    cluster,
    appSecret,
    runtimeCredentials,
    scalerCredentials,
  ]);

  const initJob = new k8s.batch.v1.Job(
    "pg-init-tables",
    {
      metadata: { namespace },
      spec: {
        backoffLimit: JOB_DEFAULTS.backoffLimit,
        ttlSecondsAfterFinished: JOB_DEFAULTS.ttlSecondsAfterFinished,
        template: {
          metadata: { labels: commonLabels("pg-init") },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            restartPolicy: "OnFailure",
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "psql",
                image: "postgres:17-alpine",
                securityContext: hardenedJobSecurityContext(),
                resources: scaledCpuRequest(BOOTSTRAP_JOB_RESOURCES),
                envFrom: [{ secretRef: { name: initDsnSecret.metadata.name } }],
                command: ["/bin/sh", "-c"],
                args: [
                  [
                    "echo 'waiting for postgres…';",
                    'until pg_isready -d "$JOBS_DSN" >/dev/null 2>&1; do sleep 2; done;',
                    'psql "$JOBS_DSN" -v ON_ERROR_STOP=1 -f /sql/jobs.sql;',
                    'psql "$CHECKPOINTS_DSN" -v ON_ERROR_STOP=1 -f /sql/checkpoints.sql;',
                    ...(filerCredentials
                      ? [
                          "echo 'waiting for the seaweedfs filer database…';",
                          'until psql "$SEAWEED_FILER_DSN" -c "select 1" >/dev/null 2>&1;',
                          "do sleep 2; done;",
                          'psql "$SEAWEED_FILER_DSN" -v ON_ERROR_STOP=1 -f /sql/seaweedfs-filer.sql;',
                        ]
                      : []),
                    "echo 'db init complete';",
                  ].join(" "),
                ],
                volumeMounts: [{ name: "sql", mountPath: "/sql" }],
              },
            ],
            volumes: [{ name: "sql", configMap: { name: initSqlCm.metadata.name } }],
          },
        },
      },
    },
    {
      provider,
      dependsOn: [
        cluster,
        renameJob,
        initSqlCm,
        initDsnSecret,
        ...(filerDatabase ? [filerDatabase] : []),
      ],
    },
  );

  const filerStoreDeps: pulumi.Resource[] = filerDatabase ? [filerDatabase, initJob] : [];

  const langfuseStoreDeps: pulumi.Resource[] = langfuseDatabase ? [langfuseDatabase] : [];

  return {
    operator,
    cluster,
    initJob,
    renameRlsRoles: (dependsOn) =>
      installRlsRoleRename(cfg, provider, namespace, renameWiring, renameScript, [renameJob, ...dependsOn]),
    pooler,
    rwHost,
    dsn,
    filerStoreDeps,
    langfuseStoreDeps,
    langfuseDsn: cfg.langfuse.enabled
      ? dsn({
          db: LANGFUSE.database,
          via: "direct",
          as: { user: LANGFUSE.databaseUser, password: cfg.langfuse.databasePassword },
        })
      : undefined,
  };
}

export function installScheduledBackup(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
): k8s.apiextensions.CustomResource | undefined {
  if (!cfg.postgres.backups.enabled) return undefined;
  return installCnpgScheduledBackup(
    "pg-scheduled-backup",
    { name: objectName("pgScheduledBackup"), cluster: CLUSTER_NAME, schedule: cfg.postgres.backups.schedule },
    provider,
    namespace,
    dependsOn,
  );
}
