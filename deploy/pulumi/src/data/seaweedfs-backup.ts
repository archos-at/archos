import * as k8s from "@pulumi/kubernetes";
import { onNodeGroup } from "../platform/scheduling";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { pullPolicyFor } from '../config/images'
import { commonLabels } from "../platform/namespaces";
import { hardenedJobSecurityContext } from "../platform/security";
import { BOOTSTRAP_JOB_RESOURCES, JOB_DEFAULTS } from "../constants";

export interface SeaweedFSBackup {
  objectMirror?: k8s.apps.v1.Deployment;
  metadataSnapshot?: k8s.batch.v1.CronJob;
}

export function installSeaweedFSBackup(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
  addresses: { master: string; filer: string },
): SeaweedFSBackup {
  const backup = cfg.seaweedfs.backup;
  if (!backup.enabled) return {};

  const labels = commonLabels("seaweedfs-backup");

  const replicationToml = pulumi
    .all([
      pulumi.output(backup.endpoint),
      pulumi.output(backup.bucket),
      pulumi.output(backup.region),
      backup.accessKey,
      backup.secretKey,
    ])
    .apply(([endpoint, bucket, region, ak, sk]) =>
      [
        "[sink.s3]",
        "enabled = true",
        `aws_access_key_id = "${ak}"`,
        `aws_secret_access_key = "${sk}"`,
        `region = "${region}"`,
        `bucket = "${bucket}"`,
        'directory = "/"',
        `endpoint = "${endpoint}"`,
        "is_incremental = true",
        "",
      ].join("\n"),
    );

  const configSecret = new k8s.core.v1.Secret(
    "seaweedfs-backup-config",
    {
      metadata: { name: "seaweedfs-backup-config", namespace },
      stringData: { "replication.toml": replicationToml },
    },
    { provider },
  );

  const objectMirror = new k8s.apps.v1.Deployment(
    "seaweedfs-backup",
    {
      metadata: { name: "seaweedfs-backup", namespace, labels },
      spec: {
        replicas: 1,
        strategy: { type: "Recreate" },
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            enableServiceLinks: false,
            ...onNodeGroup(cfg.nodeGroups.data),
            containers: [
              {
                name: "filer-backup",
                image: cfg.seaweedfs.image,
                imagePullPolicy: pullPolicyFor(cfg.seaweedfs.image),
                securityContext: hardenedJobSecurityContext(),
                command: ["/bin/sh", "-c"],
                args: [
                  `until wget -q -O /dev/null http://${addresses.filer}/healthz; ` +
                    "do echo waiting for seaweedfs filer; sleep 3; done; " +
                    "exec weed -config_dir=/etc/seaweedfs/backup filer.backup " +
                    `-filer=${addresses.filer} -filerPath=/buckets`,
                ],
                volumeMounts: [
                  { name: "backup-config", mountPath: "/etc/seaweedfs/backup", readOnly: true },
                ],
                resources: BOOTSTRAP_JOB_RESOURCES,
              },
            ],
            volumes: [
              { name: "backup-config", secret: { secretName: configSecret.metadata.name } },
            ],
          },
        },
      },
    },
    { provider, dependsOn: [...dependsOn, configSecret] },
  );

  const snapshotScript = pulumi.interpolate`
set -e
OUT=/tmp/filer-meta.$(date +%Y-%m-%dT%H-%M-%S).meta
echo "fs.meta.save -o $OUT /" | timeout 600 weed shell -master=${addresses.master} 2>&1
if [ ! -s "$OUT" ]; then echo "FATAL: metadata dump missing or empty"; exit 1; fi
echo "metadata dump $(wc -c < "$OUT") bytes"
weed filer.copy -filer=${addresses.filer} "$OUT" /buckets/${cfg.seaweedfs.bucket}/_meta-snapshots/
echo "metadata snapshot stored"
`;

  const metadataSnapshot = new k8s.batch.v1.CronJob(
    "seaweedfs-meta-snapshot",
    {
      metadata: { name: "seaweedfs-meta-snapshot", namespace, labels },
      spec: {
        schedule: backup.metadataSchedule,
        concurrencyPolicy: "Forbid",
        successfulJobsHistoryLimit: 3,
        failedJobsHistoryLimit: 3,
        jobTemplate: {
          spec: {
            backoffLimit: JOB_DEFAULTS.backoffLimit,
            ttlSecondsAfterFinished: JOB_DEFAULTS.ttlSecondsAfterFinished,
            template: {
              metadata: { labels: commonLabels("seaweedfs-meta-snapshot") },
              spec: {
                enableServiceLinks: false,
                restartPolicy: "OnFailure",
                ...onNodeGroup(cfg.nodeGroups.data),
                containers: [
                  {
                    name: "meta-snapshot",
                    image: cfg.seaweedfs.image,
                    imagePullPolicy: pullPolicyFor(cfg.seaweedfs.image),
                    securityContext: hardenedJobSecurityContext(),
                    resources: BOOTSTRAP_JOB_RESOURCES,
                    command: ["/bin/sh", "-c"],
                    args: [snapshotScript],
                  },
                ],
              },
            },
          },
        },
      },
    },
    { provider, dependsOn },
  );

  return { objectMirror, metadataSnapshot };
}
