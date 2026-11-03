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

/** The Hatchet workflow the tier runs (ADR-0150). */
export const WORKFLOW = "ingest-document";
/** The workflow the high-memory pool runs: the same steps, for files of `ingestHeavyFileBytes` or more. */
export const HEAVY_WORKFLOW = "ingest-document-heavy";
/** The high-memory pool's Deployment, and the worker label its `index` step requires (`pool=highmem`). */
export const HEAVY_TIER = "ingest-worker-heavy";
export const HEAVY_POOL = "highmem";
/** The page fan-out's task for one page, the pool that runs it, and that pool's `INGEST_WORKER_POOL` (ADR-0151). */
export const READ_PAGE_WORKFLOW = "read-page";
export const PAGE_READER_TIER = "ingest-page-reader";
export const PAGE_READ_POOL = "page-read";

/** What tells the two ingest pools apart; everything else about them is one Deployment shape. */
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

/**
 * The ingestion tier (ADR-0076, ADR-0150), the only process that runs ingestion jobs.
 *
 * Replicas of the backend image with `PROCESS_ROLE=ingest-worker`: no web port, no PVC. Each builds the ingestor once and its `concurrency` threads
 * claim jobs from Postgres, fairly across organisations (fewest running first,
 * fleet-wide). Vectors live in the shared Qdrant, jobs in Postgres, so a replica
 * is disposable.
 *
 * SCALED ON THE QUEUE, NOT ON CPU. An ingest job mostly waits on the model
 * provider, so CPU says nothing about the backlog. KEDA counts the workflow's Hatchet backlog
 * and asks for ceil(depth / concurrency) replicas between `minReplicas` and
 * `maxReplicas`: a thousand-document reindex fans out across the tier, and an
 * empty queue shrinks it back to the floor (zero, if the floor is zero).
 *
 * The ceiling that matters is not this one: every vision call holds a slot of
 * `VLM_FLEET_CONCURRENCY`, the fleet's lease pool on the shared provider key, and
 * each file's `INGEST_PAGE_READ_PARALLELISM` threads only bound its own threads
 * and memory. `assertVlmPeakFitsCeiling` fails the deploy when replicas ×
 * concurrency documents outnumber the pool's slots, or a file's pool is larger
 * than it (the pool itself held to the limiter ceilings, the vision model's own
 * included), so `ingestWorkerMaxReplicas` cannot be raised past what the
 * provider budget can feed.
 *
 * Rollout is the research tier's (`agentWorkerRollout`): surge first, then give
 * each draining worker its `drainSeconds` to finish what it claimed, plus time to
 * give back what it did not (`terminationGracePeriodSeconds` is drain + 30 s).
 * The ScaledObject is the shared queue one (`keda-scaling.ts`).
 */
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

/**
 * The high-memory pool (`ingest-worker-heavy`): the standard tier's shape with
 * `INGEST_WORKER_POOL=highmem`, so it serves `ingest-document-heavy` under the
 * worker label `pool=highmem`, 12Gi a pod and one file at a time
 * (`ingestWorkerHeavy*`). KEDA scales it on that workflow's backlog alone; the
 * prefix match is `<namespace>_ingest-document-heavy:`, which the standard
 * tier's `<namespace>_ingest-document:` never matches. Both pools share one
 * fairness limit per organisation in Hatchet (`ingest-org`, ADR-0150) and count
 * together against the vision pool (`assertVlmPeakFitsCeiling`). None when the
 * stack turns the pool off; the dispatching tiers then send every file standard.
 */
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

/**
 * The page-read pool (`ingest-page-reader`, ADR-0151): under `ingestPageFanOut` a standard
 * file is read in steps, and each page that needs a model is a `read-page` task. This pool
 * serves those tasks only (`INGEST_WORKER_POOL=page-read`), `ingestPageReaderSlots` a pod, and
 * KEDA scales it on the `read-page` backlog (`<namespace>_read-page:`), which no other pool's
 * prefix matches. The fan-out parent waits on a durable slot of the standard pool, so it never
 * holds a slot its pages need. Hatchet caps the tasks at `vlmFleetConcurrency` fleet-wide
 * (`ingest-page-read-fleet`), and the lease pool caps the calls inside them. None while the
 * fan-out is off.
 */
export function installIngestPageReader(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
): ReturnType<typeof installIngestPool> | undefined {
  const reader = cfg.ingestWorker.pageFanOut;
  if (!reader.enabled) return undefined;
  const cap = cfg.providerLimits.vlmFleetConcurrency;
  if (cap > 0 && reader.slots > cap) {
    throw new Error(
      `Invalid page-read sizing: ingestPageReaderSlots (${reader.slots}) is above vlmFleetConcurrency (${cap}). ` +
        "Hatchet runs at most that many read-page tasks fleet-wide, so a pod's extra slots could never run one.",
    );
  }
  const liveness = "/tmp/ingest-page-reader.alive";
  return installIngestPool(w, cfg, secrets, dependsOn, {
    name: PAGE_READER_TIER,
    workflow: READ_PAGE_WORKFLOW,
    env: ingestPageReaderEnv(w, liveness),
    liveness,
    resources: reader.resources,
    minReplicas: reader.minReplicas,
    maxReplicas: reader.maxReplicas,
    concurrency: reader.slots,
  });
}

/** The page-read pool's env: the ingest worker's, serving `read-page` with `ingestPageReaderSlots` slots. */
export function ingestPageReaderEnv(w: AppWiring, livenessFile: string): ReturnType<typeof ingestWorkerEnv> {
  const slots = String(w.cfg.ingestWorker.pageFanOut.slots);
  return [
    ...ingestWorkerEnv(w, livenessFile).filter((e) => e.name !== "INGEST_MAX_WORKERS"),
    { name: "INGEST_WORKER_POOL", value: PAGE_READ_POOL },
    { name: "INGEST_PAGE_READ_SLOTS", value: slots },
    { name: "INGEST_MAX_WORKERS", value: slots },
  ];
}

/**
 * The high-memory pool's env: the ingest worker's, serving `ingest-document-heavy`
 * (`INGEST_WORKER_POOL=highmem`) with one slot per heavy file it runs at once,
 * which the heavy `index` step takes all of (`INGEST_HEAVY_WORKER_SLOTS`).
 */
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
            // The batch group (`nodeGroupBatch`), when the stack has worker groups:
            // a big PDF holds gigabytes, which the app group's nodes cannot spare.
            ...onNodeGroup(cfg.nodeGroups.batch),
            containers: [
              {
                name: "ingest-worker",
                image: backendImage(cfg),
                imagePullPolicy: appPullPolicy(cfg, backendImage(cfg)),
                securityContext: hardenedContainerSecurityContext(),
                env: pool.env,
                resources: toResourceRequirements(pool.resources),
                // The worker touches the marker every 15 s while its loop runs;
                // python, because the image has no procps (see agent-worker.ts).
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
                // The first mark appears only after the whole agent-runtime workflow is
                // built; hold liveness off until then (up to 10 minutes).
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
      // KEDA owns the replica count once the ScaledObject exists.
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
