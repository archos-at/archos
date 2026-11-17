import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DeployConfig } from '../config'
import { appPullPolicy, backendImage, pullPolicyFor } from '../config/images'
import { CHROMA_MIGRATION, UID } from "../constants";
import { commonLabels } from "../platform/namespaces";
import { onNodeGroup } from "../platform/scheduling";
import { hardenedContainerSecurityContext } from "../platform/security";
import { AppSecrets, AppWiring, backendEnv } from "./config";

type EnvVar = k8s.types.input.core.v1.EnvVar;

export const EXPORTER_SOURCE = resolve(__dirname, "../../../migration/chroma_export.py");

const MOUNT = {
  exchange: "/exchange",
  migration: "/migration",
} as const;

const SCRATCH = {
  export: `${MOUNT.exchange}/export`,
  uvCache: `${MOUNT.exchange}/uv-cache`,
  home: `${MOUNT.exchange}/home`,
  tmp: `${MOUNT.exchange}/tmp`,
} as const;

function exporterEnv(): EnvVar[] {
  return [
    { name: "UV_CACHE_DIR", value: SCRATCH.uvCache },
    { name: "UV_PYTHON_DOWNLOADS", value: "never" },
    { name: "PYTHONUNBUFFERED", value: "1" },
    { name: "HOME", value: SCRATCH.home },
    { name: "TMPDIR", value: SCRATCH.tmp },
    { name: "ANONYMIZED_TELEMETRY", value: "False" },
  ];
}

function exporterScript(): string {
  try {
    return readFileSync(EXPORTER_SOURCE, "utf8");
  } catch (error) {
    throw new Error(
      `grid-oib:chromaMigration needs the exporter at ${EXPORTER_SOURCE}, which cannot be read ` +
        `(${(error as Error).message}). Deploy from a checkout that has deploy/migration/.`,
    );
  }
}

export function migrateChromaToQdrant(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
): k8s.batch.v1.Job {
  const labels = commonLabels(CHROMA_MIGRATION.name);
  const { scratchSize, timeoutMinutes } = cfg.chromaMigration;

  const script = new k8s.core.v1.ConfigMap(
    CHROMA_MIGRATION.exporterConfigMap,
    {
      metadata: { name: CHROMA_MIGRATION.exporterConfigMap, namespace: w.namespace, labels },
      data: { "chroma_export.py": exporterScript() },
    },
    { provider: w.provider },
  );

  const exchangeMount = { name: "exchange", mountPath: MOUNT.exchange };
  const readOnlyRoot = { ...hardenedContainerSecurityContext(), readOnlyRootFilesystem: true };
  const image = CHROMA_MIGRATION.exporterImage;
  const timeout = `${timeoutMinutes}m`;

  return new k8s.batch.v1.Job(
    CHROMA_MIGRATION.name,
    {
      metadata: { name: CHROMA_MIGRATION.name, namespace: w.namespace, labels },
      spec: {
        backoffLimit: CHROMA_MIGRATION.backoffLimit,
        template: {
          metadata: { labels },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            imagePullSecrets: w.imagePullSecrets,
            restartPolicy: "Never",
            securityContext: {
              runAsNonRoot: true,
              runAsUser: UID.backend,
              runAsGroup: UID.backend,
              fsGroup: UID.backend,
              fsGroupChangePolicy: "OnRootMismatch",
            },
            ...onNodeGroup(cfg.nodeGroups.batch),
            volumes: [
              {
                name: "exchange",
                ephemeral: {
                  volumeClaimTemplate: {
                    metadata: { labels },
                    spec: {
                      accessModes: ["ReadWriteOnce"],
                      storageClassName: cfg.storage.className,
                      resources: { requests: { storage: scratchSize } },
                    },
                  },
                },
              },
              { name: "migration", configMap: { name: CHROMA_MIGRATION.exporterConfigMap } },
            ],
            initContainers: [
              {
                name: "export",
                image,
                imagePullPolicy: pullPolicyFor(image),
                securityContext: readOnlyRoot,
                command: [
                  "sh",
                  "-c",
                  [
                    "set -eu",
                    `mkdir -p ${SCRATCH.home} ${SCRATCH.tmp}`,
                    `exec uv run --script ${MOUNT.migration}/chroma_export.py ` +
                      `--url ${CHROMA_MIGRATION.sourceUrl} --out ${SCRATCH.export}`,
                  ].join("\n"),
                ],
                env: exporterEnv(),
                volumeMounts: [exchangeMount, { name: "migration", mountPath: MOUNT.migration, readOnly: true }],
                resources: CHROMA_MIGRATION.exporterResources,
              },
            ],
            containers: [
              {
                name: "import",
                image: backendImage(cfg),
                imagePullPolicy: appPullPolicy(cfg, backendImage(cfg)),
                securityContext: hardenedContainerSecurityContext(),
                command: ["python", "scripts/import_vectors.py", "--in", SCRATCH.export, "--verify"],
                env: backendEnv(w, "grid-chroma-migration", "ingest"),
                volumeMounts: [exchangeMount],
                resources: CHROMA_MIGRATION.importerResources,
              },
            ],
          },
        },
      },
    },
    {
      provider: w.provider,
      dependsOn: [secrets.secret, script, ...dependsOn],
      customTimeouts: { create: timeout, update: timeout },
      ignoreChanges: ["spec"],
      deleteBeforeReplace: true,
    },
  );
}
