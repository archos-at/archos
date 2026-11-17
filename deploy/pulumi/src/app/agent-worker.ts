import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { appPullPolicy, backendImage } from '../config/images'
import { toResourceRequirements } from '../config/resources'
import { commonLabels } from "../platform/namespaces";
import { installPdb, onNodeGroup, spreadAcrossNodes } from "../platform/scheduling";
import { hardenedContainerSecurityContext } from "../platform/security";
import {
  agentWorkerRollout,
  gracefulShutdown,
  secretChecksumAnnotations,
  surgeRollout,
} from "../platform/rollout";
import { withLangfuseKeysChecksum } from "../platform/langfuse";
import { AppSecrets, AppWiring, workerEnv } from "./config";
import { installQueueScaledObject } from "./keda-scaling";
import { UID } from "../constants";

export const WORKFLOW = "research-run";

export function installAgentWorker(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
): {
  deployment: k8s.apps.v1.Deployment;
  scaledObject: k8s.apiextensions.CustomResource;
  pdb: k8s.policy.v1.PodDisruptionBudget;
} {
  const labels = commonLabels("agent-worker");
  const profile = agentWorkerRollout(cfg.agentWorker.drainSeconds);
  const shutdown = gracefulShutdown(profile);

  const deployment = new k8s.apps.v1.Deployment(
    "agent-worker",
    {
      metadata: { name: "agent-worker", namespace: w.namespace, labels },
      spec: {
        replicas: Math.max(1, cfg.agentWorker.minReplicas),
        selector: { matchLabels: labels },
        ...surgeRollout(profile),
        template: {
          metadata: {
            labels,
            annotations: secretChecksumAnnotations(withLangfuseKeysChecksum(cfg, secrets.checksum)),
          },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            imagePullSecrets: w.imagePullSecrets,
            securityContext: { runAsNonRoot: true, runAsUser: UID.backend, runAsGroup: UID.backend },
            terminationGracePeriodSeconds: shutdown.terminationGracePeriodSeconds,
            topologySpreadConstraints: spreadAcrossNodes(labels),
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "agent-worker",
                image: backendImage(cfg),
                imagePullPolicy: appPullPolicy(cfg, backendImage(cfg)),
                securityContext: hardenedContainerSecurityContext(),
                env: workerEnv(w),
                resources: toResourceRequirements(cfg.agentWorker.resources),
                livenessProbe: {
                  exec: {
                    command: [
                      "python",
                      "-c",
                      "import os,sys,time; f='/tmp/research-worker.alive'; " +
                        "sys.exit(0 if os.path.exists(f) and time.time()-os.path.getmtime(f) < 180 else 1)",
                    ],
                  },
                  initialDelaySeconds: 30,
                  periodSeconds: 30,
                  failureThreshold: 3,
                },
                startupProbe: {
                  exec: {
                    command: ["python", "-c", "import os,sys; sys.exit(0 if os.path.exists('/tmp/research-worker.alive') else 1)"],
                  },
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
    name: "agent-worker",
    deployment,
    labels,
    minReplicas: cfg.agentWorker.minReplicas,
    maxReplicas: cfg.agentWorker.maxReplicas,
    concurrency: cfg.agentWorker.concurrency,
    workflow: WORKFLOW,
    adoptHpa: "agent-worker",
    dependsOn,
  });

  const pdb = installPdb("agent-worker", w.namespace, w.provider, labels, [deployment]);

  return { deployment, scaledObject, pdb };
}
