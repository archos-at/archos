import * as k8s from "@pulumi/kubernetes";
import { onNodeGroup } from "../platform/scheduling";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { appPullPolicy, backendImage, frontendImage } from '../config/images'
import { commonLabels } from "../platform/namespaces";
import { hardenedContainerSecurityContext } from "../platform/security";
import {
  ROLLOUT,
  gracefulShutdown,
  recreateRollout,
  secretChecksumAnnotations,
} from "../platform/rollout";
import { withLangfuseKeysChecksum } from "../platform/langfuse";
import { BOOTSTRAP_JOB_RESOURCES, JOB_DEFAULTS, LIGHT_WORKER_RESOURCES, PORT, UID } from "../constants";
import { AppSecrets, AppWiring, BACKEND_URL, purgerEnv, sref } from "./config";
import { scaledCpuRequest } from "../config/cpu-requests";

const FRONTEND_URL = `http://frontend:${PORT.frontend}`;

const housekeepingUrl = (route: string) => `${BACKEND_URL}/v1/maintenance/housekeeping/${route}`;

export const BASE_CORPUS_SYNC = "housekeeping-base-corpus";

export const VECTOR_RECONCILE = "vector-reconcile";

type HousekeepingSweep = {
  name: string;
  schedule: string;
  route: string;
  timeoutMs: number;
};

function internalSweepScript(label: string, timeoutMs: number): string {
  return [
    "const url = process.env.SWEEP_URL;",
    "const token = process.env.INTERNAL_API_TOKEN;",
    `const signal = AbortSignal.timeout(${timeoutMs});`,
    "fetch(url, { method: 'POST', headers: { 'x-internal-token': token }, signal })",
    "  .then(async (response) => {",
    "    const body = await response.text();",
    "    if (!response.ok) throw new Error(`sweep failed: ${response.status} ${body}`);",
    `    console.log(\`[${label}] \${body}\`);`,
    "  })",
    "  .catch((error) => {",
    `    console.error('[${label}]', error.message);`,
    "    process.exit(1);",
    "  });",
  ].join("\n");
}

function internalSweepCronJob(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
  sweep: InternalSweep,
): k8s.batch.v1.CronJob {
  return new k8s.batch.v1.CronJob(
    sweep.name,
    {
      metadata: {
        name: sweep.name,
        namespace: w.namespace,
        labels: commonLabels(sweep.name),
      },
      spec: {
        schedule: sweep.schedule,
        concurrencyPolicy: "Forbid",
        successfulJobsHistoryLimit: 3,
        failedJobsHistoryLimit: 3,
        jobTemplate: { spec: internalSweepJobSpec(w, cfg, sweep) },
      },
    },
    { provider: w.provider, dependsOn: [secrets.secret, ...dependsOn] },
  );
}

type InternalSweep = { name: string; schedule: string; url: string; timeoutMs: number };

function internalSweepJobSpec(
  w: AppWiring,
  cfg: DeployConfig,
  sweep: Pick<InternalSweep, "name" | "url" | "timeoutMs">,
  podAnnotations?: Record<string, pulumi.Input<string>>,
): k8s.types.input.batch.v1.JobSpec {
  return {
    backoffLimit: 2,
    ttlSecondsAfterFinished: JOB_DEFAULTS.ttlSecondsAfterFinished,
    template: {
      metadata: { labels: commonLabels(sweep.name), ...(podAnnotations ? { annotations: podAnnotations } : {}) },
      spec: {
        enableServiceLinks: false, // see platform/security.ts — service-link env collisions
        imagePullSecrets: w.imagePullSecrets,
        restartPolicy: "OnFailure",
        securityContext: { runAsNonRoot: true, runAsUser: UID.frontend, runAsGroup: UID.frontend },
        ...onNodeGroup(cfg.nodeGroups.app),
        containers: [
          {
            name: sweep.name,
            image: frontendImage(cfg),
            imagePullPolicy: appPullPolicy(cfg, frontendImage(cfg)),
            securityContext: hardenedContainerSecurityContext(),
            resources: scaledCpuRequest(BOOTSTRAP_JOB_RESOURCES),
            command: ["node", "-e", internalSweepScript(sweep.name, sweep.timeoutMs)],
            env: [
              { name: "SWEEP_URL", value: sweep.url },
              sref("INTERNAL_API_TOKEN"),
            ],
          },
        ],
      },
    },
  };
}

const BASE_CORPUS_SWEEP = {
  name: BASE_CORPUS_SYNC,
  url: housekeepingUrl("base-corpus"),
  timeoutMs: 600_000,
} as const;

export function syncBaseCorpusAfterRollout(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
): k8s.batch.v1.Job {
  const name = `${BASE_CORPUS_SYNC}-deploy`;
  return new k8s.batch.v1.Job(
    name,
    {
      metadata: {
        namespace: w.namespace,
        labels: commonLabels(name),
        annotations: { "pulumi.com/skipAwait": "true" },
      },
      spec: internalSweepJobSpec(w, cfg, { ...BASE_CORPUS_SWEEP, name }, { "deploy/backend-image": backendImage(cfg) }),
    },
    { provider: w.provider, dependsOn: [secrets.secret, ...dependsOn] },
  );
}

export function installWorkers(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
): {
  purger: k8s.apps.v1.Deployment;
  storageAlerts?: k8s.batch.v1.CronJob;
  vectorReconcile?: k8s.batch.v1.CronJob;
  housekeeping: k8s.batch.v1.CronJob[];
  baseCorpusSync: k8s.batch.v1.CronJob;
} {
  const workerResources = LIGHT_WORKER_RESOURCES;
  const shutdown = gracefulShutdown(ROLLOUT.lightWorker);

  const purger = new k8s.apps.v1.Deployment(
    "purger",
    {
      metadata: { name: "purger", namespace: w.namespace, labels: commonLabels("purger") },
      spec: {
        replicas: 1,
        ...recreateRollout(ROLLOUT.lightWorker),
        selector: { matchLabels: commonLabels("purger") },
        template: {
          metadata: {
            labels: commonLabels("purger"),
            annotations: secretChecksumAnnotations(withLangfuseKeysChecksum(cfg, secrets.checksum)),
          },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            imagePullSecrets: w.imagePullSecrets,
            securityContext: { runAsNonRoot: true, runAsUser: UID.frontend, runAsGroup: UID.frontend },
            terminationGracePeriodSeconds: shutdown.terminationGracePeriodSeconds,
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "purger",
                image: frontendImage(cfg),
                imagePullPolicy: appPullPolicy(cfg, frontendImage(cfg)),
                securityContext: hardenedContainerSecurityContext(),
                command: ["node", "purger/index.js"],
                env: purgerEnv(w),
                resources: scaledCpuRequest(workerResources),
              },
            ],
          },
        },
      },
    },
    { provider: w.provider, dependsOn: [secrets.secret, ...dependsOn] },
  );

  const storageAlerts = cfg.storageAlerts.enabled
    ? internalSweepCronJob(w, cfg, secrets, dependsOn, {
        name: "storage-alerts",
        schedule: cfg.storageAlerts.schedule,
        url: `${FRONTEND_URL}/api/internal/storage/alerts`,
        timeoutMs: 600_000,
      })
    : undefined;

  const vectorReconcile = cfg.vectorReconcile.enabled
    ? internalSweepCronJob(w, cfg, secrets, dependsOn, {
        name: VECTOR_RECONCILE,
        schedule: cfg.vectorReconcile.schedule,
        url: `${FRONTEND_URL}/api/internal/maintenance/reconcile-vectors`,
        timeoutMs: 1_800_000,
      })
    : undefined;

  const housekeepingSweep = ({ route, ...sweep }: HousekeepingSweep) =>
    internalSweepCronJob(w, cfg, secrets, dependsOn, {
      ...sweep,
      url: housekeepingUrl(route),
    });
  const baseCorpusSync = housekeepingSweep({
    name: BASE_CORPUS_SYNC,
    schedule: "*/10 * * * *",
    route: "base-corpus",
    timeoutMs: 600_000,
  });
  const housekeeping = [
    ...[
      { name: "housekeeping-ghost-jobs", schedule: "*/2 * * * *", route: "ghost-jobs", timeoutMs: 90_000 },
      { name: "housekeeping-job-events", schedule: "7 * * * *", route: "job-events", timeoutMs: 900_000 },
      { name: "housekeeping-chat-checkpoints", schedule: "37 * * * *", route: "chat-checkpoints", timeoutMs: 900_000 },
    ].map(housekeepingSweep),
    baseCorpusSync,
  ];

  return { purger, storageAlerts, vectorReconcile, housekeeping, baseCorpusSync };
}
