import * as k8s from "@pulumi/kubernetes";
import { onNodeGroup } from "../platform/scheduling";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { pullPolicyFor } from '../config/images'
import { commonLabels } from "../platform/namespaces";
import {
  ROLLOUT,
  gracefulShutdown,
  orderedRollout,
  secretChecksumAnnotations,
} from "../platform/rollout";
import { DATA_RESOURCES, PORT, SEAWEED } from "../constants";
import { scrapeAnnotations } from "../platform/scrape";
import { growPvcToConfigured } from "./pvc-grow";
import type { SeaweedTopology } from "./seaweedfs-types";

export function installSingleNodeSeaweedFS(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  s3Secret: k8s.core.v1.Secret,
  configChecksum: pulumi.Output<string>,
): SeaweedTopology {
  const labels = commonLabels(SEAWEED.filer);

  const seaweedPorts = [
    { port: PORT.seaweedS3, name: "s3" },
    { port: PORT.seaweedMaster, name: "master" },
    { port: PORT.seaweedMasterGrpc, name: "master-grpc" },
    { port: PORT.seaweedFiler, name: "filer" },
    { port: PORT.seaweedFilerGrpc, name: "filer-grpc" },
  ];

  const headless = new k8s.core.v1.Service(
    "seaweedfs-headless",
    {
      metadata: { name: "seaweedfs-headless", namespace, labels },
      spec: { clusterIP: "None", selector: labels, ports: seaweedPorts },
    },
    { provider },
  );

  const statefulSet = new k8s.apps.v1.StatefulSet(
    "seaweedfs",
    {
      metadata: { name: SEAWEED.filer, namespace, labels },
      spec: {
        serviceName: headless.metadata.name,
        replicas: 1,
        persistentVolumeClaimRetentionPolicy: { whenDeleted: "Retain", whenScaled: "Retain" },
        ...orderedRollout(ROLLOUT.dataPlane),
        selector: { matchLabels: labels },
        template: {
          metadata: {
            labels,
            annotations: { ...secretChecksumAnnotations(configChecksum), ...scrapeAnnotations(PORT.seaweedMetrics) },
          },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            securityContext: { fsGroup: 1000 },
            terminationGracePeriodSeconds:
              gracefulShutdown(ROLLOUT.dataPlane).terminationGracePeriodSeconds,
            ...onNodeGroup(cfg.nodeGroups.data),
            containers: [
              {
                name: "seaweedfs",
                image: cfg.seaweedfs.image,
                imagePullPolicy: pullPolicyFor(cfg.seaweedfs.image),
                command: ["/bin/sh", "-c"],
                args: [
                  `exec weed server -dir=/data -volume.max=${cfg.seaweedfs.volumeMaxCount} -s3 ` +
                    `-s3.config=/etc/seaweedfs/s3.json -s3.port=8333 -metricsPort=${PORT.seaweedMetrics}` +
                    (cfg.seaweedfs.encryptVolumeData ? " -filer.encryptVolumeData" : ""),
                ],
                ports: [
                  ...seaweedPorts.map((p) => ({ containerPort: p.port, name: p.name })),
                  { containerPort: PORT.seaweedMetrics, name: "metrics" },
                ],
                volumeMounts: [
                  { name: "data", mountPath: "/data" },
                  { name: "s3config", mountPath: "/etc/seaweedfs", readOnly: true },
                ],
                readinessProbe: {
                  httpGet: { path: "/healthz", port: PORT.seaweedS3 },
                  initialDelaySeconds: 10,
                  periodSeconds: 5,
                  failureThreshold: 12,
                },
                livenessProbe: {
                  tcpSocket: { port: PORT.seaweedMaster },
                  initialDelaySeconds: 30,
                  periodSeconds: 15,
                },
                resources: {
                  requests: { ...DATA_RESOURCES.seaweedfs.requests, memory: cfg.seaweedfs.singleMemory.request },
                  limits: { ...DATA_RESOURCES.seaweedfs.limits, memory: cfg.seaweedfs.singleMemory.limit },
                },
              },
            ],
            volumes: [{ name: "s3config", secret: { secretName: s3Secret.metadata.name } }],
          },
        },
        volumeClaimTemplates: [
          {
            metadata: { name: "data" },
            spec: {
              accessModes: ["ReadWriteOnce"],
              storageClassName: cfg.storage.className,
              resources: { requests: { storage: cfg.seaweedfs.storageSize } },
            },
          },
        ],
      },
    },
    {
      provider,
      dependsOn: s3Secret,
      ignoreChanges: ["spec.volumeClaimTemplates"],
      deleteBeforeReplace: true,
      protect: cfg.protectDataResources,
    },
  );

  const service = new k8s.core.v1.Service(
    "seaweedfs",
    {
      metadata: { name: SEAWEED.filer, namespace, labels },
      spec: { selector: labels, ports: seaweedPorts },
    },
    { provider, dependsOn: statefulSet },
  );

  if (cfg.seaweedfs.growVolume) {
    growPvcToConfigured("seaweedfs-data-size", {
      provider,
      namespace,
      pvcName: `data-${SEAWEED.filer}-0`,
      configured: cfg.seaweedfs.storageSize,
      dependsOn: [statefulSet],
    });
  }

  return {
    workloads: [statefulSet],
    service,
    masterService: service,
    masterAddress: `${SEAWEED.filer}:${PORT.seaweedMaster}`,
    filerAddress: `${SEAWEED.filer}:${PORT.seaweedFiler}`,
    pdbs: [],
  };
}
