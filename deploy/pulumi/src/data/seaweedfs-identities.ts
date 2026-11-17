import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { LANGFUSE, QDRANT } from "../constants";
import { CMS } from "../config/cms";

const OBJECT_ACTIONS = ["Read", "Write", "List", "Tagging"] as const;

export interface S3IdentityInputs {
  platformBuckets: string[];
  tenantBucketPrefix: string;
  provisioning: boolean;
}

export interface S3IdentityShape {
  name: string;
  actions: string[];
}

export function s3IdentityCatalog({
  documentsBucket,
  platformBuckets,
  tenantBucketPrefix,
  provisioning,
  langfuseBucket,
  qdrantBucket,
  cmsBucket,
}: {
  documentsBucket: string;
  platformBuckets: string[];
  tenantBucketPrefix: string;
  provisioning: boolean;
  langfuseBucket?: string;
  qdrantBucket?: string;
  cmsBucket?: string;
}): S3IdentityShape[] {
  const tenantScope = (action: string): string[] => [`${action}:${tenantBucketPrefix}*`];

  const appBuckets = platformBuckets.filter(
    (bucket) => bucket !== langfuseBucket && bucket !== qdrantBucket && bucket !== cmsBucket,
  );

  const perBucket = (action: string): string[] => [
    ...appBuckets.map((bucket) => `${action}:${bucket}`),
    ...tenantScope(action),
  ];

  const identities: S3IdentityShape[] = [
    {
      name: "grid",
      actions: OBJECT_ACTIONS.flatMap(perBucket),
    },
    {
      name: "grid-backend-read",
      actions: [
        ...platformBuckets
          .filter((bucket) => bucket === documentsBucket)
          .map((bucket) => `Read:${bucket}`),
        ...tenantScope("Read"),
      ],
    },
  ];

  if (provisioning) {
    identities.push({
      name: "grid-tenant-admin",
      actions: [`Admin:${tenantBucketPrefix}*`],
    });
  }

  if (langfuseBucket) {
    identities.push({
      name: LANGFUSE.s3Identity,
      actions: OBJECT_ACTIONS.map((action) => `${action}:${langfuseBucket}`),
    });
  }

  if (qdrantBucket) {
    identities.push({
      name: QDRANT.s3Identity,
      actions: OBJECT_ACTIONS.map((action) => `${action}:${qdrantBucket}`),
    });
  }

  if (cmsBucket) {
    identities.push({ name: CMS.s3Identity, actions: OBJECT_ACTIONS.map((action) => `${action}:${cmsBucket}`) });
  }

  return identities;
}

export function renderS3Config(
  cfg: DeployConfig,
  { platformBuckets, tenantBucketPrefix, provisioning }: S3IdentityInputs,
): pulumi.Output<string> {
  return pulumi
    .all([
      pulumi.output(cfg.seaweedfs.accessKey),
      cfg.seaweedfs.secretKey,
      pulumi.output(cfg.seaweedfs.backendReadAccessKey),
      cfg.seaweedfs.backendReadSecretKey,
      pulumi.output(cfg.seaweedfs.tenantAdminAccessKey),
      cfg.seaweedfs.tenantAdminSecretKey,
      pulumi.output(cfg.langfuse.s3AccessKey),
      cfg.langfuse.s3SecretKey,
      pulumi.output(cfg.qdrant.snapshots.s3AccessKey),
      cfg.qdrant.snapshots.s3SecretKey,
      pulumi.output(cfg.cms.s3AccessKey),
      cfg.cms.s3SecretKey,
    ])
    .apply(([ak, sk, brak, brsk, taak, task, lfak, lfsk, qdak, qdsk, cmak, cmsk]) => {
      const credentials: Record<string, { accessKey: string; secretKey: string }> = {
        grid: { accessKey: ak, secretKey: sk },
        "grid-backend-read": { accessKey: brak, secretKey: brsk },
        "grid-tenant-admin": { accessKey: taak, secretKey: task },
        [LANGFUSE.s3Identity]: { accessKey: lfak, secretKey: lfsk },
        [QDRANT.s3Identity]: { accessKey: qdak, secretKey: qdsk },
        [CMS.s3Identity]: { accessKey: cmak, secretKey: cmsk },
      };

      const identities = s3IdentityCatalog({
        documentsBucket: cfg.seaweedfs.bucket,
        platformBuckets,
        tenantBucketPrefix,
        provisioning,
        langfuseBucket: cfg.langfuse.enabled ? LANGFUSE.bucket : undefined,
        qdrantBucket: QDRANT.snapshotBucket,
        cmsBucket: cfg.cms.enabled ? CMS.bucket : undefined,
      }).map((identity) => ({
        name: identity.name,
        credentials: [credentials[identity.name]],
        actions: identity.actions,
      }));

      return JSON.stringify({ identities });
    });
}

export function s3ConfigSecret(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  inputs: S3IdentityInputs,
): k8s.core.v1.Secret {
  return new k8s.core.v1.Secret(
    "seaweedfs-s3-config",
    {
      metadata: { name: "seaweedfs-s3-config", namespace },
      stringData: { "s3.json": renderS3Config(cfg, inputs) },
    },
    { provider },
  );
}
