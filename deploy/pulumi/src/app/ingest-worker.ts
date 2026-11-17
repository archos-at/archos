import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { appPullPolicy, backendImage } from '../config/images'
import { toResourceRequirements } from '../config/resources'
import { assertVlmPeakFitsCeiling } from '../config/vlm-ceiling'
import { commonLabels } from "../platform/namespaces";
import { installPdb, onNodeGroup, spreadAcrossNodes } from "../platform/scheduling";
import { hardenedContainerSecurityContext } from "../platform/security";
import { agentWorkerRollout, gracefulShutdown, secretChecksumAnnotations, surgeRollout } from "../platform/rollout";
import { AppSecrets, AppWiring, ingestWorkerEnv } from "./config";
import { installQueueScaledObject } from "./keda-scaling";
import { UID } from "../constants";

export const WORKFLOW = "ingest-document";
export const HEAVY_WORKFLOW = "ingest-document-heavy";
export const HEAVY_TIER = "ingest-worker-heavy";
export const HEAVY_POOL = "highmem";

interface IngestPool {
  name: string;
  workflow: string;
  env: ReturnType<typeof ingestWorkerEnv>;
  liveness: string;
  resources: DeployConfig["ingestWorker"]["resources"];
  minReplicas: number;
  maxReplicas: number;
  concurrency: number;
}

export function installIngestWorker(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
): {
  deployment: k8s.apps.v1.Deployment;
  scaledObject: k8s.apiextensions.CustomResource;
  pdb: k8s.policy.v1.PodDisruptionBudget;
} {
  assertVlmPeakFitsCeiling(cfg);
  const liveness = "/tmp/ingest-worker.alive";
  return installIngestPool(w, cfg, secrets, dependsOn, {
    name: "ingest-worker",
    workflow: WORKFLOW,
    env: ingestWorkerEnv(w, liveness),
    liveness,
    resources: cfg.ingestWorker.resources,
    minReplicas: cfg.ingestWorker.minReplicas,
    maxReplicas: cfg.ingestWorker.maxReplicas,
    concurrency: cfg.ingestWorker.concurrency,
  });
}

export function installIngestWorkerHeavy(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
): ReturnType<typeof installIngestPool> | undefined {
  const heavy = cfg.ingestWorker.heavy;
  if (!heavy.enabled) return undefined;
  assertVlmPeakFitsCeiling(cfg);
  const liveness = "/tmp/ingest-worker-heavy.alive";
  return installIngestPool(w, cfg, secrets, dependsOn, {
    name: HEAVY_TIER,
    workflow: HEAVY_WORKFLOW,
    env: ingestWorkerHeavyEnv(w, liveness),
    liveness,
    resources: heavy.resources,
    minReplicas: heavy.minReplicas,
    maxReplicas: heavy.maxReplicas,
    concurrency: heavy.concurrency,
  });
}

export function ingestWorkerHeavyEnv(w: AppWiring, livenessFile: string): ReturnType<typeof ingestWorkerEnv> {
  const slots = String(w.cfg.ingestWorker.heavy.concurrency);
  return [
    ...ingestWorkerEnv(w, livenessFile).filter((e) => e.name !== "INGEST_MAX_WORKERS"),
    { name: "INGEST_WORKER_POOL", value: "highmem" },
    { name: "INGEST_HEAVY_WORKER_SLOTS", value: slots },
    { name: "INGEST_MAX_WORKERS", value: slots },
  ];
}

function installIngestPool(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
  pool: IngestPool,
): {
  deployment: k8s.apps.v1.Deployment;
  scaledObject: k8s.apiextensions.CustomResource;
  pdb: k8s.policy.v1.PodDisruptionBudget;
} {
  const labels = commonLabels(pool.name);
  const profile = agentWorkerRollout(cfg.ingestWorker.drainSeconds);
  const shutdown = gracefulShutdown(profile);
  const liveness = pool.liveness;

  const deployment = new k8s.apps.v1.Deployment(
    pool.name,
    {
      metadata: { name: pool.name, namespace: w.namespace, labels },
      spec: {
        replicas: Math.max(1, pool.minReplicas),
        selector: { matchLabels: labels },
        ...surgeRollout(profile),
        template: {
          metadata: { labels, annotations: secretChecksumAnnotations(secrets.checksum) },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            imagePullSecrets: w.imagePullSecrets,
            securityContext: { runAsNonRoot: true, runAsUser: UID.backend, runAsGroup: UID.backend },
            terminationGracePeriodSeconds: shutdown.terminationGracePeriodSeconds,
            topologySpreadConstraints: spreadAcrossNodes(labels),
            ...onNodeGroup(cfg.nodeGroups.batch),
            containers: [
              {
                name: "ingest-worker",
                image: backendImage(cfg),
                imagePullPolicy: appPullPolicy(cfg, backendImage(cfg)),
                securityContext: hardenedContainerSecurityContext(),
                env: pool.env,
                resources: toResourceRequirements(pool.resources),
                livenessProbe: {
                  exec: {
                    command: [
                      "python",
                      "-c",
                      `import os,sys,time; f='${liveness}'; ` +
                        "sys.exit(0 if os.path.exists(f) and time.time()-os.path.getmtime(f) < 120 else 1)",
                    ],
                  },
                  initialDelaySeconds: 30,
                  periodSeconds: 30,
                  failureThreshold: 3,
                },
                startupProbe: {
                  exec: { command: ["python", "-c", `import os,sys; sys.exit(0 if os.path.exists('${liveness}') else 1)`] },
                  periodSeconds: 10,
                  failureThreshold: 60,
                },
              },
            ],
          },
        },
      },
    },
    {
      provider: w.provider,
      dependsOn: [secrets.secret, ...dependsOn],
      ignoreChanges: ["spec.replicas"],
      customTimeouts: {
        create: `${Math.ceil(profile.progressDeadlineSeconds / 60) + 15}m`,
        update: `${Math.ceil(profile.progressDeadlineSeconds / 60) + 15}m`,
      },
    },
  );

  const scaledObject = installQueueScaledObject(w, {
    name: pool.name,
    deployment,
    labels,
    minReplicas: pool.minReplicas,
    maxReplicas: pool.maxReplicas,
    concurrency: pool.concurrency,
    workflow: pool.workflow,
    dependsOn,
  });

  const pdb = installPdb(pool.name, w.namespace, w.provider, labels, [deployment]);
  return { deployment, scaledObject, pdb };
}
