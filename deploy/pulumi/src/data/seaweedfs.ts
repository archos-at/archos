import * as k8s from "@pulumi/kubernetes";
import { onNodeGroup } from "../platform/scheduling";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { commonLabels } from "../platform/namespaces";
import { hardenedJobSecurityContext } from "../platform/security";
import { BOOTSTRAP_JOB_RESOURCES, JOB_DEFAULTS, PORT, SEAWEED } from "../constants";
import { secretChecksum } from "../platform/rollout";
import { renderS3Config, s3ConfigSecret } from "./seaweedfs-identities";
import { installSingleNodeSeaweedFS } from "./seaweedfs-single";
import { filerToml, installSplitSeaweedFS, leveldbFilerToml } from "./seaweedfs-split";
import type { SeaweedTopology } from "./seaweedfs-types";

export interface SeaweedFS extends SeaweedTopology {
  bucketInitJob: k8s.batch.v1.Job;
  internalEndpoint: pulumi.Output<string>;
  publicEndpoint: pulumi.Output<string>;
}

export function installSeaweedFS(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  extraBuckets: string[] = [],
  postgresHost = "",
  filerStoreDeps: pulumi.Resource[] = [],
): SeaweedFS {
  const platformBuckets = [cfg.seaweedfs.bucket, ...extraBuckets];

  const identityInputs = {
    platformBuckets,
    tenantBucketPrefix: cfg.seaweedfs.tenantBucketPrefix,
    provisioning: cfg.seaweedfs.perOrgBuckets,
  };
  const s3Secret = s3ConfigSecret(cfg, provider, namespace, identityInputs);

  const configChecksum = secretChecksum({
    "s3.json": renderS3Config(cfg, identityInputs),
    "filer.toml":
      cfg.seaweedfs.topology === "split" && cfg.seaweedfs.filerStore === "postgres"
        ? filerToml(cfg, postgresHost)
        : pulumi.output(leveldbFilerToml()),
  });

  const topology =
    cfg.seaweedfs.topology === "split"
      ? installSplitSeaweedFS(
          cfg,
          provider,
          namespace,
          s3Secret,
          configChecksum,
          postgresHost,
          filerStoreDeps,
        )
      : installSingleNodeSeaweedFS(cfg, provider, namespace, s3Secret, configChecksum);

  const master = topology.masterAddress;
  const createBuckets = platformBuckets
    .map(
      (b) =>
        `echo 's3.bucket.create -name ${b}' | timeout 120 weed shell -master=${master} 2>&1; ` +
        `if ! echo 's3.bucket.list' | timeout 120 weed shell -master=${master} 2>&1 | grep -qE '(^|>) *${b}([^a-zA-Z0-9_-]|$)'; ` +
        `then echo "FATAL: bucket ${b} missing after create"; exit 1; fi; ` +
        `echo "bucket ${b} verified"`,
    )
    .join("; ");

  const bucketInitJob = new k8s.batch.v1.Job(
    "seaweedfs-bucket-init",
    {
      metadata: { namespace },
      spec: {
        backoffLimit: JOB_DEFAULTS.backoffLimit,
        ttlSecondsAfterFinished: JOB_DEFAULTS.ttlSecondsAfterFinished,
        template: {
          metadata: { labels: commonLabels("seaweedfs-init") },
          spec: {
            enableServiceLinks: false,
            restartPolicy: "OnFailure",
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "bucket-init",
                image: cfg.seaweedfs.image,
                securityContext: hardenedJobSecurityContext(),
                resources: BOOTSTRAP_JOB_RESOURCES,
                command: ["/bin/sh", "-c"],
                args: [
                  `until wget -q -O /dev/null http://${master}/cluster/status; ` +
                    "do echo waiting for seaweedfs master; sleep 3; done; " +
                    `until wget -q -O /dev/null http://${topology.filerAddress}/healthz; ` +
                    "do echo waiting for seaweedfs filer; sleep 3; done; " +
                    createBuckets,
                ],
              },
            ],
          },
        },
      },
    },
    { provider, dependsOn: [topology.service, topology.masterService] },
  );

  return {
    ...topology,
    bucketInitJob,
    internalEndpoint: pulumi.output(`http://${SEAWEED.filer}:${PORT.seaweedS3}`),
    publicEndpoint: pulumi.output(`https://${cfg.ingress.s3Domain}`),
  };
}
