import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { appPullPolicy, backendImage } from '../config/images'
import { assertHpaTargetIsProportional, assertMemoryFitsLimit, toResourceRequirements } from '../config/resources'
import { commonLabels } from "../platform/namespaces";
import { installPdb, onNodeGroup, spreadAcrossNodes } from "../platform/scheduling";
import { hardenedContainerSecurityContext } from "../platform/security";
import {
  ROLLOUT,
  assertStartupFitsRollout,
  gracefulShutdown,
  secretChecksumAnnotations,
  startupBudgetSeconds,
  surgeRollout,
} from "../platform/rollout";
import { withLangfuseKeysChecksum } from "../platform/langfuse";
import { AppSecrets, AppWiring, apiEnv } from "./config";
import { PORT, UID } from "../constants";
import { API_TIER } from "./tier-names";

export interface Api {
  deployment: k8s.apps.v1.Deployment;
  service: k8s.core.v1.Service;
  hpa: k8s.autoscaling.v2.HorizontalPodAutoscaler;
  pdb: k8s.policy.v1.PodDisruptionBudget;
}

const STARTUP_PERIOD_SECONDS = 10;
const STARTUP_FAILURE_THRESHOLD = 60;

export function installApi(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
  name: string = API_TIER,
): Api {
  const labels = commonLabels(name);
  const shutdown = gracefulShutdown(ROLLOUT.api, "python");

  assertHpaTargetIsProportional(name, cfg.api.resources, cfg.api.hpaCpuTargetPercent);
  assertMemoryFitsLimit(name, cfg.api.resources);
  assertStartupFitsRollout(
    name,
    ROLLOUT.api,
    startupBudgetSeconds(STARTUP_PERIOD_SECONDS, STARTUP_FAILURE_THRESHOLD),
  );

  const deployment = new k8s.apps.v1.Deployment(
    name,
    {
      metadata: { name, namespace: w.namespace, labels },
      spec: {
        replicas: cfg.api.minReplicas,
        selector: { matchLabels: labels },
        ...surgeRollout(ROLLOUT.api),
        template: {
          metadata: {
            labels,
            annotations: secretChecksumAnnotations(withLangfuseKeysChecksum(cfg, secrets.checksum)),
          },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            imagePullSecrets: w.imagePullSecrets,
            terminationGracePeriodSeconds: shutdown.terminationGracePeriodSeconds,
            securityContext: { runAsNonRoot: true, runAsUser: UID.backend, runAsGroup: UID.backend },
            topologySpreadConstraints: spreadAcrossNodes(labels),
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name,
                image: backendImage(cfg),
                imagePullPolicy: appPullPolicy(cfg, backendImage(cfg)),
                securityContext: hardenedContainerSecurityContext(),
                ports: [{ containerPort: PORT.backend, name: "http" }],
                env: apiEnv(w),
                resources: toResourceRequirements(cfg.api.resources),
                lifecycle: shutdown.lifecycle,
                startupProbe: {
                  httpGet: { path: "/health", port: PORT.backend },
                  periodSeconds: STARTUP_PERIOD_SECONDS,
                  failureThreshold: STARTUP_FAILURE_THRESHOLD,
                },
                readinessProbe: {
                  httpGet: { path: "/health", port: PORT.backend },
                  periodSeconds: 15,
                  timeoutSeconds: 10,
                },
                livenessProbe: {
                  httpGet: { path: "/health", port: PORT.backend },
                  periodSeconds: 20,
                  timeoutSeconds: 10,
                  failureThreshold: 6,
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
      customTimeouts: { create: "25m", update: "25m" },
    },
  );

  const service = new k8s.core.v1.Service(
    name,
    {
      metadata: { name, namespace: w.namespace, labels },
      spec: {
        selector: labels,
        ports: [{ port: PORT.backend, targetPort: PORT.backend, name: "http" }],
      },
    },
    { provider: w.provider, dependsOn: deployment },
  );

  const hpa = new k8s.autoscaling.v2.HorizontalPodAutoscaler(
    name,
    {
      metadata: { name, namespace: w.namespace, labels },
      spec: {
        scaleTargetRef: {
          apiVersion: "apps/v1",
          kind: "Deployment",
          name: deployment.metadata.name,
        },
        minReplicas: cfg.api.minReplicas,
        maxReplicas: cfg.api.maxReplicas,
        metrics: [
          {
            type: "Resource",
            resource: {
              name: "cpu",
              target: { type: "Utilization", averageUtilization: cfg.api.hpaCpuTargetPercent },
            },
          },
        ],
      },
    },
    { provider: w.provider, dependsOn: deployment },
  );

  const pdb = installPdb(name, w.namespace, w.provider, labels, [deployment]);

  return { deployment, service, hpa, pdb };
}
