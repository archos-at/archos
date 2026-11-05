/**
 * `cms-pg` (ADR-0155): the CloudNativePG cluster the website's CMS keeps its
 * posts, revisions, users and configuration in, in the CMS's own namespace.
 *
 * Its own cluster rather than a database on the application's, for the reason
 * `background-work-pg.ts` gives and one more: the CMS is a public login page
 * with its own administrators, and nothing it can be talked into should share a
 * primary, a superuser or a backup with the offices' data.
 *
 * Built from the shared `cnpgClusterSpec` (`cnpg.ts`), small: one database and
 * its owner, no pooler (Payload pools per pod, `DATABASE_POOL_MAX`). The PITR
 * archive (`cmsPgBackup*`) has no in-cluster default and is meant for object
 * storage outside the cluster, as for `background-work-pg`.
 */
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { CMS } from "../config/cms";
import { commonLabels } from "../platform/namespaces";
import { cnpgClusterSpec, installBackupSecret, installCnpgScheduledBackup } from "./cnpg";

/** The primary's Service, by FQDN: its certificate names it so, and the CMS verifies it. */
export const CMS_PG_HOST = `${CMS.cluster}-rw.${CMS.namespace}.svc`;
/** The Secret CloudNativePG writes the cluster's CA into (`<cluster>-ca`, key `ca.crt`). */
export const CMS_PG_CA_SECRET = `${CMS.cluster}-ca`; // pragma: allowlist secret

export interface CmsPostgres {
  cluster: k8s.apiextensions.CustomResource;
}

export function installCmsPostgres(
  cfg: DeployConfig,
  provider: k8s.Provider,
  /** The namespace, and the CNPG operator's webhook being ready (the app cluster). */
  dependsOn: pulumi.Resource[],
): CmsPostgres {
  const pg = cfg.cms.postgres;
  const namespace = CMS.namespace;
  const owner = new k8s.core.v1.Secret(
    "cms-pg-owner",
    {
      metadata: { name: "cms-pg-owner", namespace },
      type: "kubernetes.io/basic-auth",
      stringData: { username: CMS.owner, password: pg.password },
    },
    { provider, dependsOn },
  );
  const backupSecretName = `${CMS.cluster}-backup-s3`; // pragma: allowlist secret
  const backupSecret =
    pg.backups.enabled && pg.backups.accessKey && pg.backups.secretKey
      ? installBackupSecret("cms-pg-backup-s3", backupSecretName, namespace, provider, {
          accessKey: pg.backups.accessKey,
          secretKey: pg.backups.secretKey,
        })
      : undefined;
  if (pg.backups.enabled && !backupSecret) {
    throw new Error("cmsPgBackupsEnabled needs cmsPgBackupAccessKey and cmsPgBackupSecretKey: the archive goes to object storage outside the cluster.");
  }

  const cluster = new k8s.apiextensions.CustomResource(
    CMS.cluster,
    {
      apiVersion: "postgresql.cnpg.io/v1",
      kind: "Cluster",
      metadata: { name: CMS.cluster, namespace, labels: commonLabels("postgres") },
      spec: cnpgClusterSpec({
        instances: pg.instances,
        storageSize: pg.storageSize,
        storageClass: cfg.storage.className,
        primaryUpdateStrategy: cfg.postgres.primaryUpdateStrategy,
        dataNodeGroup: cfg.nodeGroups.data,
        resources: { requests: { cpu: "100m", memory: "512Mi" }, limits: { cpu: "1", memory: "512Mi" } },
        parameters: { max_connections: String(CMS.maxConnections), shared_buffers: "128MB" },
        bootstrap: { database: CMS.database, owner: CMS.owner, secret: owner.metadata.name },
        roles: [{ name: CMS.owner, passwordSecret: owner.metadata.name, connectionLimit: CMS.maxConnections - 10 }],
        enableSuperuserAccess: false,
        backups: pg.backups,
        backupSecretName,
      }),
    },
    {
      provider,
      dependsOn: [owner, ...(backupSecret ? [backupSecret] : []), ...dependsOn],
      // CloudNativePG owns the PVCs: deleting this CR drops every post.
      protect: cfg.protectDataResources,
    },
  );

  if (pg.backups.enabled) {
    installCnpgScheduledBackup(
      "cms-pg-scheduled-backup",
      { name: `${CMS.cluster}-nightly`, cluster: CMS.cluster, schedule: pg.backups.schedule },
      provider,
      namespace,
      [cluster],
    );
  }
  return { cluster };
}
