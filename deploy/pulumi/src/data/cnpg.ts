/**
 * The parts of a CloudNativePG cluster that every cluster in the program shares:
 * the `Cluster` spec's common shape, its Barman PITR archive and its nightly base
 * backup. The application's cluster (`postgres.ts`) and the background-work
 * cluster Hatchet runs on (`background-work-pg.ts`) are both built from here, so
 * a fix to how a cluster is placed, tuned or backed up reaches both.
 */
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { BarmanBackups } from "../config/barman-backups";
import { onNodeGroup } from "../platform/scheduling";
import { scrapeAnnotations } from "../platform/scrape";
import { commonLabels } from "../platform/namespaces";
import { PORT, POSTGRES_TUNING } from "../constants";

/** A role CloudNativePG reconciles as superuser (`spec.managed.roles`). */
export interface CnpgManagedRole {
  name: string;
  /** The basic-auth Secret holding its password. */
  passwordSecret: pulumi.Input<string>;
  /** `CONNECTION LIMIT`; omitted means unlimited (-1), the operator's default. */
  connectionLimit?: number;
}

export interface CnpgClusterSpec {
  instances: number;
  storageSize: string;
  storageClass: string;
  primaryUpdateStrategy: "unsupervised" | "supervised";
  /** The data node group, when the stack has one (`nodeGroupData`). */
  dataNodeGroup?: string;
  resources: { requests: Record<string, string>; limits: Record<string, string> };
  /** `postgresql.parameters`, on top of the keepalives every cluster shares. */
  parameters: Record<string, string>;
  bootstrap: { database: string; owner: string; secret: pulumi.Input<string>; postInitSQL?: string[] };
  roles: CnpgManagedRole[];
  enableSuperuserAccess: boolean;
  /** The Barman archive; disabled leaves the spec without a `backup` key. */
  backups: BarmanBackups;
  backupSecretName: string;
}

/**
 * Login attributes of every managed role: no superuser, no CREATEDB, no
 * CREATEROLE, no BYPASSRLS. A role that needs more is not a managed role.
 */
function managedRole(role: CnpgManagedRole) {
  return {
    name: role.name,
    ensure: "present",
    login: true,
    superuser: false,
    createdb: false,
    createrole: false,
    bypassrls: false,
    ...(role.connectionLimit === undefined ? {} : { connectionLimit: role.connectionLimit }),
    passwordSecret: { name: role.passwordSecret },
  };
}

/**
 * The `backup` block of a Cluster, or nothing when the archive is off.
 *
 * NOTE: this uses CNPG's in-tree `barmanObjectStore`. It is stable and works on
 * current operators but is being superseded by the barman-cloud plugin; if a
 * future auto-pulled operator (the chart is unpinned) drops the in-tree path,
 * the webhook will reject this at `pulumi up`: switch to the plugin then.
 *
 * ENCRYPTION. `encryption` is a field of `wal` and `data`, NOT of
 * `barmanObjectStore` itself, and its CRD enum is `AES256;"aws:kms"` with no
 * empty member, so "inherit the bucket policy" is the key being ABSENT; emitting
 * `encryption: ""` would be rejected by the webhook. barman-cloud turns it into
 * an `x-amz-server-side-encryption` header, which encrypts nothing unless the
 * DESTINATION implements SSE. The in-cluster SeaweedFS (3.80) does not, which
 * is why `loadBarmanBackups` refuses that combination. Said plainly in
 * docs/deployment/kubernetes.md § Encryption posture.
 */
export function barmanBackupSpec(backups: BarmanBackups, secretName: string) {
  if (!backups.enabled) return {};
  const encryptionField = backups.encryption ? { encryption: backups.encryption } : {};
  return {
    backup: {
      retentionPolicy: backups.retention,
      barmanObjectStore: {
        destinationPath: `s3://${backups.bucket}/`,
        endpointURL: backups.endpoint,
        s3Credentials: {
          accessKeyId: { name: secretName, key: "ACCESS_KEY_ID" },
          secretAccessKey: { name: secretName, key: "SECRET_ACCESS_KEY" },
        },
        wal: { compression: "gzip", maxParallel: 2, ...encryptionField },
        data: { compression: "gzip", ...encryptionField },
      },
    },
  };
}

/**
 * The `spec` of a CloudNativePG `Cluster`.
 *
 * Every cluster gets the same placement and the same safety: the instances'
 * exporter annotated for the node agents (ADR-0119), a major-pinned image,
 * anti-affinity across nodes (required on a data group, which is fixed in size;
 * preferred without one so a small cluster still schedules), and the TCP
 * keepalives and idle-in-transaction timeout of `POSTGRES_TUNING`, which free
 * what a dead client held.
 */
export function cnpgClusterSpec(spec: CnpgClusterSpec) {
  return {
    instances: spec.instances,
    inheritedMetadata: { annotations: scrapeAnnotations(PORT.postgresMetrics) },
    // Major-pinned, patch-floating: every 17.x patch, never an automatic major,
    // which CloudNativePG treats as a declarative migration.
    imageName: "ghcr.io/cloudnative-pg/postgresql:17",
    primaryUpdateStrategy: spec.primaryUpdateStrategy,
    affinity: {
      enablePodAntiAffinity: true,
      topologyKey: "kubernetes.io/hostname",
      podAntiAffinityType: spec.dataNodeGroup ? "required" : "preferred",
      ...onNodeGroup(spec.dataNodeGroup),
    },
    storage: { size: spec.storageSize, storageClass: spec.storageClass },
    enableSuperuserAccess: spec.enableSuperuserAccess,
    managed: { roles: spec.roles.map(managedRole) },
    bootstrap: {
      initdb: {
        database: spec.bootstrap.database,
        owner: spec.bootstrap.owner,
        secret: { name: spec.bootstrap.secret },
        ...(spec.bootstrap.postInitSQL ? { postInitSQL: spec.bootstrap.postInitSQL } : {}),
      },
    },
    postgresql: {
      parameters: {
        ...spec.parameters,
        tcp_keepalives_idle: POSTGRES_TUNING.tcpKeepalivesIdle,
        tcp_keepalives_interval: POSTGRES_TUNING.tcpKeepalivesInterval,
        tcp_keepalives_count: POSTGRES_TUNING.tcpKeepalivesCount,
        idle_in_transaction_session_timeout: POSTGRES_TUNING.idleInTransactionSessionTimeout,
      },
    },
    resources: spec.resources,
    ...barmanBackupSpec(spec.backups, spec.backupSecretName),
  };
}

/** The archive's S3 credentials, as the Secret `barmanBackupSpec` names, or nothing when the archive is off. */
export function installBackupSecret(
  logical: string,
  name: string,
  namespace: pulumi.Input<string>,
  provider: k8s.Provider,
  credentials: { accessKey: pulumi.Input<string>; secretKey: pulumi.Input<string> },
): k8s.core.v1.Secret {
  return new k8s.core.v1.Secret(
    logical,
    {
      metadata: { name, namespace },
      stringData: { ACCESS_KEY_ID: credentials.accessKey, SECRET_ACCESS_KEY: credentials.secretKey },
    },
    { provider },
  );
}

/**
 * The nightly base backup of a cluster. `immediate: true` takes the first one on
 * creation, and CloudNativePG does not retry a failed `Backup`, so whatever this
 * depends on must prove the archive bucket exists (`installScheduledBackup` in
 * `postgres.ts` explains the one topology where that ordering is load-bearing).
 */
export function installCnpgScheduledBackup(
  logical: string,
  opts: { name: string; cluster: string; schedule: string },
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
): k8s.apiextensions.CustomResource {
  return new k8s.apiextensions.CustomResource(
    logical,
    {
      apiVersion: "postgresql.cnpg.io/v1",
      kind: "ScheduledBackup",
      metadata: { name: opts.name, namespace, labels: commonLabels("postgres") },
      spec: {
        schedule: opts.schedule,
        backupOwnerReference: "self",
        cluster: { name: opts.cluster },
        method: "barmanObjectStore",
        immediate: true,
      },
    },
    { provider, dependsOn },
  );
}
