import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { appPullPolicy, frontendImage } from '../config/images'
import { toResourceRequirements } from '../config/resources'
import { commonLabels } from "../platform/namespaces";
import { installPdb, onNodeGroup, spreadAcrossNodes } from "../platform/scheduling";
import { hardenedContainerSecurityContext } from "../platform/security";
import { agentWorkerRollout, gracefulShutdown, secretChecksumAnnotations, surgeRollout } from "../platform/rollout";
import { withLangfuseKeysChecksum } from "../platform/langfuse";
import { AppSecrets, AppWiring } from "./config";
import { bffJobsEnv } from "./bff-jobs-env";
import { installQueueScaledObject } from "./keda-scaling";
import { PORT, UID } from "../constants";

/** The Hatchet workflow the pool runs (ADR-0150), one task with the job kind in its input. */
export const WORKFLOW = "bff-job";

/**
 * The BFF's background pool (ADR-0079, ADR-0150): replicas of the FRONTEND image that run
 * `workers/jobs/index.js`: the Hatchet worker of the `bff-job` task, running
 * the BFF's services bundled at image build (`dist-jobs/slice.mjs`) in its own
 * process, a bounded slice per run. Hatchet hands the runs out, fairly across
 * organizations. So the heavy work lands here, never on the user-facing
 * frontend pods that proxy chat. The process answers the probes'
 * `/api/healthz` itself.
 *
 * INTERNAL ONLY. No Service and no HTTPRoute: nothing routes to these pods;
 * the worker dials out to Hatchet (`bff-jobs.spec.ts` asserts both).
 *
 * On SIGTERM the worker takes no new run and lets the ones in hand finish for
 * the drain budget; a run cut off is retried by Hatchet on another pod, from
 * the progress its row saved.
 *
 * SCALED ON THE BACKLOG, NOT ON CPU: KEDA counts the `bff-job` runs Hatchet
 * holds queued or running (`hatchetBacklogQuery`) and asks for
 * ceil(depth / concurrency) replicas between `minReplicas` and `maxReplicas`. A
 * lane is one organization, so a burst from one office fans out across the
 * pool and a lone job from another still takes the next free slot.
 *
 * Rollout and grace follow the other queue pools (`agentWorkerRollout`): surge
 * first, then each draining pod gets its drain budget plus slack to exit.
 */
export function installBffJobs(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
): {
  deployment: k8s.apps.v1.Deployment;
  scaledObject: k8s.apiextensions.CustomResource;
  pdb: k8s.policy.v1.PodDisruptionBudget;
} {
  const labels = commonLabels("bff-jobs");
  // The grace period is the drain budget (the runner's) plus the time to stop
  // the BFF after it (`agentWorkerRollout` adds it).
  const profile = agentWorkerRollout(cfg.bffJobs.drainSeconds);
  const shutdown = gracefulShutdown(profile);

  const deployment = new k8s.apps.v1.Deployment(
    "bff-jobs",
    {
      metadata: { name: "bff-jobs", namespace: w.namespace, labels },
      spec: {
        replicas: Math.max(1, cfg.bffJobs.minReplicas),
        selector: { matchLabels: labels },
        ...surgeRollout(profile),
        template: {
          metadata: { labels, annotations: secretChecksumAnnotations(withLangfuseKeysChecksum(cfg, secrets.checksum)) },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            imagePullSecrets: w.imagePullSecrets,
            securityContext: { runAsNonRoot: true, runAsUser: UID.frontend, runAsGroup: UID.frontend },
            terminationGracePeriodSeconds: shutdown.terminationGracePeriodSeconds,
            topologySpreadConstraints: spreadAcrossNodes(labels),
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "bff-jobs",
                image: frontendImage(cfg),
                imagePullPolicy: appPullPolicy(cfg, frontendImage(cfg)),
                securityContext: hardenedContainerSecurityContext(),
                // Not `node server.js`: this supervises it (and skips the
                // image's migrate step, which the migration Job owns).
                command: ["node", "workers/jobs/index.js"],
                // Named for the probes only. Nothing routes to it: there is no
                // Service, and the runner reaches the BFF on 127.0.0.1.
                ports: [{ containerPort: PORT.frontend, name: "http" }],
                env: bffJobsEnv(w),
                resources: toResourceRequirements(cfg.bffJobs.resources),
                // The supervisor exits when the BFF does, so a dead BFF is a
                // restarted pod; these catch one that is up but not serving.
                startupProbe: {
                  httpGet: { path: "/api/healthz", port: PORT.frontend },
                  periodSeconds: 5,
                  failureThreshold: 36,
                },
                readinessProbe: {
                  httpGet: { path: "/api/healthz", port: PORT.frontend },
                  periodSeconds: 10,
                },
                livenessProbe: {
                  httpGet: { path: "/api/healthz", port: PORT.frontend },
                  periodSeconds: 15,
                  failureThreshold: 5,
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
    name: "bff-jobs",
    deployment,
    labels,
    minReplicas: cfg.bffJobs.minReplicas,
    maxReplicas: cfg.bffJobs.maxReplicas,
    concurrency: cfg.bffJobs.concurrency,
    workflow: WORKFLOW,
    dependsOn,
  });

  const pdb = installPdb("bff-jobs", w.namespace, w.provider, labels, [deployment]);
  return { deployment, scaledObject, pdb };
}
