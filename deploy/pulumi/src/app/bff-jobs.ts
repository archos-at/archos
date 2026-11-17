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

export const WORKFLOW = "bff-job";

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
                command: ["node", "workers/jobs/index.js"],
                ports: [{ containerPort: PORT.frontend, name: "http" }],
                env: bffJobsEnv(w),
                resources: toResourceRequirements(cfg.bffJobs.resources),
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
