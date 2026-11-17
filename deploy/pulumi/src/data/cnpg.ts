import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { BarmanBackups } from "../config/barman-backups";
import { onNodeGroup } from "../platform/scheduling";
import { scrapeAnnotations } from "../platform/scrape";
import { commonLabels } from "../platform/namespaces";
import { PORT, POSTGRES_TUNING } from "../constants";

export interface CnpgManagedRole {
  name: string;
  passwordSecret: pulumi.Input<string>;
  connectionLimit?: number;
}

export interface CnpgClusterSpec {
  instances: number;
  storageSize: string;
  storageClass: string;
  primaryUpdateStrategy: "unsupervised" | "supervised";
  dataNodeGroup?: string;
  resources: { requests: Record<string, string>; limits: Record<string, string> };
  parameters: Record<string, string>;
  bootstrap: { database: string; owner: string; secret: pulumi.Input<string>; postInitSQL?: string[] };
  roles: CnpgManagedRole[];
  enableSuperuserAccess: boolean;
  backups: BarmanBackups;
  backupSecretName: string;
}

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

export function cnpgClusterSpec(spec: CnpgClusterSpec) {
  return {
    instances: spec.instances,
    inheritedMetadata: { annotations: scrapeAnnotations(PORT.postgresMetrics) },
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
