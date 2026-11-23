import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { appPullPolicy, frontendImage } from '../config/images'
import { assertHpaTargetIsProportional, assertMemoryFitsLimit, toResourceRequirements } from '../config/resources'
import { commonLabels } from "../platform/namespaces";
import { installPdb, onNodeGroup, spreadAcrossNodes } from "../platform/scheduling";
import { hardenedContainerSecurityContext } from "../platform/security";
import {
  ROLLOUT,
  gracefulShutdown,
  secretChecksumAnnotations,
  surgeRollout,
} from "../platform/rollout";
import { withLangfuseKeysChecksum } from "../platform/langfuse";
import { AppSecrets, AppWiring, frontendEnv } from "./config";
import { installMcpAdmissionSecret, platformMcpServerEnv } from "../platform/mcp-gateway";
import { formerAgentOriginsEnv } from "./former-domain";
import { PORT, UID } from "../constants";
import { cpuUtilizationTarget } from "../config/cpu-requests";

export interface Frontend {
  deployment: k8s.apps.v1.Deployment;
  service: k8s.core.v1.Service;
  hpa: k8s.autoscaling.v2.HorizontalPodAutoscaler;
  pdb: k8s.policy.v1.PodDisruptionBudget;
}

export function installFrontend(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
): Frontend {
  const labels = commonLabels("frontend");
  const shutdown = gracefulShutdown(ROLLOUT.frontend, "node");

  assertHpaTargetIsProportional(
    "frontend",
    cfg.frontend.resources,
    cfg.frontend.hpaCpuTargetPercent,
  );
  assertMemoryFitsLimit("frontend", cfg.frontend.resources);

  const admissionSecret = installMcpAdmissionSecret(cfg, w.provider, w.namespace);
  const deployment = new k8s.apps.v1.Deployment(
    "frontend",
    {
      metadata: { name: "frontend", namespace: w.namespace, labels },
      spec: {
        replicas: cfg.frontend.minReplicas,
        selector: { matchLabels: labels },
        ...surgeRollout(ROLLOUT.frontend),
        template: {
          metadata: {
            labels,
            annotations: secretChecksumAnnotations(withLangfuseKeysChecksum(cfg, secrets.checksum)),
          },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            imagePullSecrets: w.imagePullSecrets,
            terminationGracePeriodSeconds: shutdown.terminationGracePeriodSeconds,
            securityContext: { runAsNonRoot: true, runAsUser: UID.frontend, runAsGroup: UID.frontend },
            topologySpreadConstraints: spreadAcrossNodes(labels),
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "frontend",
                image: frontendImage(cfg),
                imagePullPolicy: appPullPolicy(cfg, frontendImage(cfg)),
                securityContext: hardenedContainerSecurityContext(),
                command: ["node", "server.js"],
                ports: [{ containerPort: PORT.frontend, name: "http" }],
                env: [...frontendEnv(w), ...platformMcpServerEnv(cfg), ...formerAgentOriginsEnv(cfg.ingress)],
                resources: toResourceRequirements(cfg.frontend.resources),
                lifecycle: shutdown.lifecycle,
                readinessProbe: {
                  httpGet: { path: "/api/healthz", port: PORT.frontend },
                  initialDelaySeconds: 10,
                  periodSeconds: 10,
                },
                livenessProbe: {
                  httpGet: { path: "/api/healthz", port: PORT.frontend },
                  initialDelaySeconds: 30,
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
      dependsOn: [secrets.secret, ...(admissionSecret ? [admissionSecret] : []), ...dependsOn],
      ignoreChanges: ["spec.replicas"],
      customTimeouts: { create: "20m", update: "20m" },
    },
  );

  const service = new k8s.core.v1.Service(
    "frontend",
    {
      metadata: { name: "frontend", namespace: w.namespace, labels },
      spec: {
        selector: labels,
        ports: [{ port: PORT.frontend, targetPort: PORT.frontend, name: "http" }],
      },
    },
    { provider: w.provider, dependsOn: deployment },
  );

  const hpa = new k8s.autoscaling.v2.HorizontalPodAutoscaler(
    "frontend",
    {
      metadata: { name: "frontend", namespace: w.namespace, labels },
      spec: {
        scaleTargetRef: {
          apiVersion: "apps/v1",
          kind: "Deployment",
          name: deployment.metadata.name,
        },
        minReplicas: cfg.frontend.minReplicas,
        maxReplicas: cfg.frontend.maxReplicas,
        metrics: [
          {
            type: "Resource",
            resource: {
              name: "cpu",
              target: {
                type: "Utilization",
                averageUtilization: cpuUtilizationTarget(cfg.frontend.hpaCpuTargetPercent),
              },
            },
          },
        ],
      },
    },
    { provider: w.provider, dependsOn: deployment },
  );

  const pdb = installPdb("frontend", w.namespace, w.provider, labels, [deployment]);

  return { deployment, service, hpa, pdb };
}
