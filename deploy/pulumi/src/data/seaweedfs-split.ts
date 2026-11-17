import * as k8s from "@pulumi/kubernetes";
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
import { installPdb, onNodeGroup, spreadAcrossNodes } from "../platform/scheduling";
import { DATA_RESOURCES, PORT, SEAWEED } from "../constants";
import { scrapeAnnotations } from "../platform/scrape";
import type { SeaweedTopology } from "./seaweedfs-types";

const METRICS_PORT = { containerPort: PORT.seaweedMetrics, name: "metrics" };

const FILER_GROUP = "grid";

const CONFIG_DIR = "/etc/seaweedfs";

export function filerToml(cfg: DeployConfig, host: string): pulumi.Output<string> {
  const q = (value: string): string => JSON.stringify(value);

  return cfg.seaweedfs.filerDatabasePassword.apply((password) =>
    [
      "[filer.options]",
      "recursive_delete = false",
      "",
      "[postgres2]",
      "enabled = true",
      'createTable = """',
      '  CREATE TABLE IF NOT EXISTS "%s" (',
      "    dirhash   BIGINT,",
      "    name      VARCHAR(65535),",
      "    directory VARCHAR(65535),",
      "    meta      bytea,",
      "    PRIMARY KEY (dirhash, name)",
      "  );",
      '"""',
      `hostname = ${q(host)}`,
      `port = ${PORT.postgres}`,
      `username = ${q(cfg.seaweedfs.filerDatabaseUser)}`,
      `password = ${q(password)}`,
      `database = ${q(cfg.seaweedfs.filerDatabase)}`,
      'schema = ""',
      'sslmode = "require"',
      "connection_max_idle = 10",
      "connection_max_open = 40",
      "connection_max_lifetime_seconds = 3600",
      "enableUpsert = true",
      'upsertQuery = """INSERT INTO "%[1]s" (dirhash,name,directory,meta) VALUES($1,$2,$3,$4) ' +
        'ON CONFLICT (dirhash,name) DO UPDATE SET directory=EXCLUDED.directory, meta=EXCLUDED.meta"""',
      "",
    ].join("\n"),
  );
}

export function leveldbFilerToml(): string {
  return [
    "[filer.options]",
    "recursive_delete = false",
    "",
    "[leveldb2]",
    "enabled = true",
    'dir = "/data/filerldb2"',
    "",
  ].join("\n");
}

const IDENTITY_ENV: k8s.types.input.core.v1.EnvVar[] = [
  { name: "POD_NAME", valueFrom: { fieldRef: { fieldPath: "metadata.name" } } },
  { name: "POD_NAMESPACE", valueFrom: { fieldRef: { fieldPath: "metadata.namespace" } } },
  { name: "NODE_NAME", valueFrom: { fieldRef: { fieldPath: "spec.nodeName" } } },
];

function peerService(
  name: string,
  namespace: pulumi.Input<string>,
  provider: k8s.Provider,
  labels: pulumi.Input<{ [k: string]: string }>,
  ports: Array<{ port: number; name: string }>,
): k8s.core.v1.Service {
  return new k8s.core.v1.Service(
    name,
    {
      metadata: { name, namespace, labels },
      spec: {
        clusterIP: "None",
        selector: labels,
        ports,
        publishNotReadyAddresses: true,
      },
    },
    { provider },
  );
}

export function installSplitSeaweedFS(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  s3Secret: k8s.core.v1.Secret,
  configChecksum: pulumi.Output<string>,
  postgresHost: string,
  filerStoreDeps: pulumi.Resource[],
): SeaweedTopology {
  const masterLabels = commonLabels(SEAWEED.master);
  const volumeLabels = commonLabels(SEAWEED.volume);
  const filerLabels = commonLabels(SEAWEED.filer);

  const masterPorts = [
    { port: PORT.seaweedMaster, name: "master" },
    { port: PORT.seaweedMasterGrpc, name: "master-grpc" },
  ];
  const volumePorts = [
    { port: PORT.seaweedVolume, name: "volume" },
    { port: PORT.seaweedVolumeGrpc, name: "volume-grpc" },
  ];
  const filerPorts = [
    { port: PORT.seaweedS3, name: "s3" },
    { port: PORT.seaweedFiler, name: "filer" },
    { port: PORT.seaweedFilerGrpc, name: "filer-grpc" },
  ];

  const masterPeer = peerService(SEAWEED.masterPeer, namespace, provider, masterLabels, masterPorts);

  const masterPeers = pulumi
    .output(namespace)
    .apply((ns) =>
      Array.from(
        { length: cfg.seaweedfs.masterReplicas },
        (_, i) =>
          `${SEAWEED.master}-${i}.${SEAWEED.masterPeer}.${ns}.svc.cluster.local:${PORT.seaweedMaster}`,
      ).join(","),
    );

  const masterArgs = pulumi.interpolate`exec weed master \
 -mdir=/data \
 -ip=$(POD_NAME).${SEAWEED.masterPeer}.$(POD_NAMESPACE).svc.cluster.local \
 -ip.bind=0.0.0.0 \
 -port=${PORT.seaweedMaster} \
 -peers=${masterPeers} \
 -volumeSizeLimitMB=${cfg.seaweedfs.volumeSizeLimitMB} \
 -defaultReplication=${cfg.seaweedfs.defaultReplication} \
 -metricsPort=${PORT.seaweedMetrics}`;

  const master = new k8s.apps.v1.StatefulSet(
    "seaweedfs-master",
    {
      metadata: { name: SEAWEED.master, namespace, labels: masterLabels },
      spec: {
        serviceName: masterPeer.metadata.name,
        replicas: cfg.seaweedfs.masterReplicas,
        persistentVolumeClaimRetentionPolicy: { whenDeleted: "Retain", whenScaled: "Retain" },
        ...orderedRollout(ROLLOUT.dataPlane),
        selector: { matchLabels: masterLabels },
        template: {
          metadata: { labels: masterLabels, annotations: scrapeAnnotations(PORT.seaweedMetrics) },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            securityContext: { fsGroup: 1000 },
            topologySpreadConstraints: spreadAcrossNodes(masterLabels),
            ...onNodeGroup(cfg.nodeGroups.data),
            ...gracefulShutdown(ROLLOUT.dataPlane),
            containers: [
              {
                name: "master",
                image: cfg.seaweedfs.image,
                imagePullPolicy: pullPolicyFor(cfg.seaweedfs.image),
                command: ["/bin/sh", "-c"],
                args: [masterArgs],
                env: IDENTITY_ENV,
                ports: [...masterPorts.map((p) => ({ containerPort: p.port, name: p.name })), METRICS_PORT],
                volumeMounts: [{ name: "data", mountPath: "/data" }],
                readinessProbe:
                  cfg.seaweedfs.masterReplicas > 1
                    ? {
                        httpGet: { path: "/cluster/healthz", port: PORT.seaweedMaster },
                        initialDelaySeconds: 5,
                        periodSeconds: 5,
                        failureThreshold: 12,
                      }
                    : {
                        tcpSocket: { port: PORT.seaweedMaster },
                        initialDelaySeconds: 5,
                        periodSeconds: 5,
                        failureThreshold: 12,
                      },
                livenessProbe: {
                  tcpSocket: { port: PORT.seaweedMaster },
                  initialDelaySeconds: 30,
                  periodSeconds: 15,
                },
                resources: DATA_RESOURCES.seaweedfsMaster,
              },
            ],
          },
        },
        volumeClaimTemplates: [
          {
            metadata: { name: "data" },
            spec: {
              accessModes: ["ReadWriteOnce"],
              storageClassName: cfg.storage.className,
              resources: { requests: { storage: cfg.seaweedfs.masterStorageSize } },
            },
          },
        ],
      },
    },
    {
      provider,
      dependsOn: masterPeer,
      ignoreChanges: ["spec.volumeClaimTemplates"],
      deleteBeforeReplace: true,
      protect: cfg.protectDataResources,
    },
  );

  const masterService = new k8s.core.v1.Service(
    "seaweedfs-master-svc",
    {
      metadata: { name: SEAWEED.master, namespace, labels: masterLabels },
      spec: { selector: masterLabels, ports: masterPorts },
    },
    { provider, dependsOn: master },
  );

  const masterAddress = `${SEAWEED.master}:${PORT.seaweedMaster}`;

  const volumePeer = peerService(SEAWEED.volumePeer, namespace, provider, volumeLabels, volumePorts);

  const volumeArgs = pulumi.interpolate`exec weed volume \
 -dir=/data \
 -max=${cfg.seaweedfs.volumeMaxCount} \
 -mserver=${masterAddress} \
 -ip=$(POD_NAME).${SEAWEED.volumePeer}.$(POD_NAMESPACE).svc.cluster.local \
 -ip.bind=0.0.0.0 \
 -port=${PORT.seaweedVolume} \
 -rack=$(NODE_NAME) \
 -minFreeSpace=${cfg.seaweedfs.volumeMinFreeSpace} \
 -metricsPort=${PORT.seaweedMetrics}`;

  const volume = new k8s.apps.v1.StatefulSet(
    "seaweedfs-volume",
    {
      metadata: { name: SEAWEED.volume, namespace, labels: volumeLabels },
      spec: {
        serviceName: volumePeer.metadata.name,
        replicas: cfg.seaweedfs.volumeReplicas,
        persistentVolumeClaimRetentionPolicy: { whenDeleted: "Retain", whenScaled: "Retain" },
        ...orderedRollout(ROLLOUT.dataPlane),
        selector: { matchLabels: volumeLabels },
        template: {
          metadata: { labels: volumeLabels, annotations: scrapeAnnotations(PORT.seaweedMetrics) },
          spec: {
            enableServiceLinks: false,
            securityContext: { fsGroup: 1000 },
            topologySpreadConstraints: spreadAcrossNodes(volumeLabels),
            ...onNodeGroup(cfg.nodeGroups.data),
            ...gracefulShutdown(ROLLOUT.dataPlane),
            containers: [
              {
                name: "volume",
                image: cfg.seaweedfs.image,
                imagePullPolicy: pullPolicyFor(cfg.seaweedfs.image),
                command: ["/bin/sh", "-c"],
                args: [volumeArgs],
                env: IDENTITY_ENV,
                ports: [...volumePorts.map((p) => ({ containerPort: p.port, name: p.name })), METRICS_PORT],
                volumeMounts: [{ name: "data", mountPath: "/data" }],
                readinessProbe: {
                  httpGet: { path: "/healthz", port: PORT.seaweedVolume },
                  initialDelaySeconds: 5,
                  periodSeconds: 10,
                  failureThreshold: 12,
                },
                livenessProbe: {
                  tcpSocket: { port: PORT.seaweedVolume },
                  initialDelaySeconds: 30,
                  periodSeconds: 15,
                },
                resources: DATA_RESOURCES.seaweedfsVolume,
              },
            ],
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
      dependsOn: [volumePeer, master],
      ignoreChanges: ["spec.volumeClaimTemplates"],
      deleteBeforeReplace: true,
      protect: cfg.protectDataResources,
    },
  );

  const usePostgres = cfg.seaweedfs.filerStore === "postgres";

  const filerConfigSecret = new k8s.core.v1.Secret(
    "seaweedfs-filer-config",
    {
      metadata: { name: "seaweedfs-filer-config", namespace },
      stringData: {
        "filer.toml": usePostgres
          ? filerToml(cfg, postgresHost)
          : pulumi.output(leveldbFilerToml()),
      },
    },
    { provider },
  );

  const filerPeer = peerService(SEAWEED.filerPeer, namespace, provider, filerLabels, filerPorts);

  const filerArgs = pulumi.interpolate`exec weed -config_dir=${CONFIG_DIR} filer \
 -master=${masterAddress} \
 -filerGroup=${FILER_GROUP} \
 -ip=$(POD_NAME).${SEAWEED.filerPeer}.$(POD_NAMESPACE).svc.cluster.local \
 -ip.bind=0.0.0.0 \
 -port=${PORT.seaweedFiler} \
 -defaultStoreDir=/data \
 -s3 \
 -s3.config=${CONFIG_DIR}/s3.json \
 -s3.port=${PORT.seaweedS3} \
 -metricsPort=${PORT.seaweedMetrics}${cfg.seaweedfs.encryptVolumeData ? " -encryptVolumeData" : ""}`;

  const filer = new k8s.apps.v1.StatefulSet(
    "seaweedfs-filer",
    {
      metadata: { name: SEAWEED.filer, namespace, labels: filerLabels },
      spec: {
        serviceName: filerPeer.metadata.name,
        replicas: cfg.seaweedfs.filerReplicas,
        persistentVolumeClaimRetentionPolicy: { whenDeleted: "Retain", whenScaled: "Retain" },
        ...orderedRollout(ROLLOUT.dataPlane),
        selector: { matchLabels: filerLabels },
        template: {
          metadata: {
            labels: filerLabels,
            annotations: { ...secretChecksumAnnotations(configChecksum), ...scrapeAnnotations(PORT.seaweedMetrics) },
          },
          spec: {
            enableServiceLinks: false,
            securityContext: { fsGroup: 1000 },
            topologySpreadConstraints: spreadAcrossNodes(filerLabels),
            ...gracefulShutdown(ROLLOUT.dataPlane),
            ...onNodeGroup(cfg.nodeGroups.data),
            containers: [
              {
                name: "filer",
                image: cfg.seaweedfs.image,
                imagePullPolicy: pullPolicyFor(cfg.seaweedfs.image),
                command: ["/bin/sh", "-c"],
                args: [filerArgs],
                env: IDENTITY_ENV,
                ports: [...filerPorts.map((p) => ({ containerPort: p.port, name: p.name })), METRICS_PORT],
                volumeMounts: [
                  { name: "config", mountPath: CONFIG_DIR, readOnly: true },
                  { name: "filer-data", mountPath: "/data" },
                ],
                readinessProbe: {
                  httpGet: { path: "/healthz", port: PORT.seaweedFiler },
                  initialDelaySeconds: 5,
                  periodSeconds: 10,
                  failureThreshold: 12,
                },
                livenessProbe: {
                  httpGet: { path: "/healthz", port: PORT.seaweedFiler },
                  initialDelaySeconds: 30,
                  periodSeconds: 30,
                  failureThreshold: 4,
                },
                resources: DATA_RESOURCES.seaweedfsFiler,
              },
            ],
            volumes: [
              {
                name: "config",
                projected: {
                  sources: [
                    { secret: { name: filerConfigSecret.metadata.name } },
                    { secret: { name: s3Secret.metadata.name } },
                  ],
                },
              },
            ],
          },
        },
        volumeClaimTemplates: [
          {
            metadata: { name: "filer-data" },
            spec: {
              accessModes: ["ReadWriteOnce"],
              storageClassName: cfg.storage.className,
              resources: { requests: { storage: cfg.seaweedfs.filerStorageSize } },
            },
          },
        ],
      },
    },
    {
      provider,
      dependsOn: [filerPeer, filerConfigSecret, s3Secret, master, volume, ...filerStoreDeps],
      ignoreChanges: ["spec.volumeClaimTemplates"],
      deleteBeforeReplace: true,
      protect: cfg.protectDataResources,
    },
  );

  const service = new k8s.core.v1.Service(
    "seaweedfs",
    {
      metadata: { name: SEAWEED.filer, namespace, labels: filerLabels },
      spec: { selector: filerLabels, ports: filerPorts },
    },
    { provider, dependsOn: filer },
  );

  const pdbs: k8s.policy.v1.PodDisruptionBudget[] = [];
  if (cfg.seaweedfs.masterReplicas > 1) {
    pdbs.push(installPdb("seaweedfs-master-pdb", namespace, provider, masterLabels, [master]));
  }
  if (cfg.seaweedfs.volumeReplicas > 1) {
    pdbs.push(installPdb("seaweedfs-volume-pdb", namespace, provider, volumeLabels, [volume]));
  }
  if (cfg.seaweedfs.filerReplicas > 1) {
    pdbs.push(installPdb("seaweedfs-filer-pdb", namespace, provider, filerLabels, [filer]));
  }

  return {
    workloads: [master, volume, filer],
    service,
    masterService,
    masterAddress,
    filerAddress: `${SEAWEED.filer}:${PORT.seaweedFiler}`,
    pdbs,
  };
}
