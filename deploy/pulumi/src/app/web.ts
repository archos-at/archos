import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { appPullPolicy, webImage } from '../config/images'
import { assertHpaTargetIsProportional, assertMemoryFitsLimit, toResourceRequirements } from '../config/resources'
import { webPosthogEnv } from "./posthog-env";
import { webCmsEnv } from "../platform/cms";
import { commonLabels } from "../platform/namespaces";
import { installPdb, onNodeGroup, spreadAcrossNodes } from "../platform/scheduling";
import { hardenedContainerSecurityContext } from "../platform/security";
import { ROLLOUT, gracefulShutdown, surgeRollout } from "../platform/rollout";
import { PORT, UID } from "../constants";

export const WEB_HEALTH_PATH = "/healthz";

export interface Web {
  deployment: k8s.apps.v1.Deployment;
  service: k8s.core.v1.Service;
  hpa: k8s.autoscaling.v2.HorizontalPodAutoscaler;
  pdb: k8s.policy.v1.PodDisruptionBudget;
}

export function installWeb(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  imagePullSecrets: { name: string }[],
  dependsOn: pulumi.Resource[],
): Web {
  const labels = commonLabels("web");
  const shutdown = gracefulShutdown(ROLLOUT.web, "node");

  assertHpaTargetIsProportional("web", cfg.web.resources, cfg.web.hpaCpuTargetPercent);
  assertMemoryFitsLimit("web", cfg.web.resources);

  const deployment = new k8s.apps.v1.Deployment(
    "web",
    {
      metadata: { name: "web", namespace, labels },
      spec: {
        replicas: cfg.web.minReplicas,
        selector: { matchLabels: labels },
        ...surgeRollout(ROLLOUT.web),
        template: {
          metadata: { labels },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            imagePullSecrets,
            terminationGracePeriodSeconds: shutdown.terminationGracePeriodSeconds,
            securityContext: { runAsNonRoot: true, runAsUser: UID.web, runAsGroup: UID.web },
            topologySpreadConstraints: spreadAcrossNodes(labels),
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "web",
                image: webImage(cfg),
                imagePullPolicy: appPullPolicy(cfg, webImage(cfg)),
                securityContext: hardenedContainerSecurityContext(),
                ports: [{ containerPort: PORT.web, name: "http" }],
                env: [
                  { name: "HOST", value: "0.0.0.0" },
                  { name: "PORT", value: String(PORT.web) },
                  {
                    name: "PUBLIC_APP_URL",
                    value: `https://${cfg.ingress.appDomain}`,
                  },
                  ...webPosthogEnv(cfg),
                  ...webCmsEnv(cfg),
                ],
                resources: toResourceRequirements(cfg.web.resources),
                lifecycle: shutdown.lifecycle,
                readinessProbe: {
                  httpGet: { path: WEB_HEALTH_PATH, port: PORT.web },
                  initialDelaySeconds: 5,
                  periodSeconds: 10,
                },
                livenessProbe: {
                  httpGet: { path: WEB_HEALTH_PATH, port: PORT.web },
                  initialDelaySeconds: 15,
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
      provider,
      dependsOn,
      ignoreChanges: ["spec.replicas"],
      customTimeouts: { create: "20m", update: "20m" },
    },
  );

  const service = new k8s.core.v1.Service(
    "web",
    {
      metadata: { name: "web", namespace, labels },
      spec: {
        selector: labels,
        ports: [{ port: PORT.web, targetPort: PORT.web, name: "http" }],
      },
    },
    { provider, dependsOn: deployment },
  );

  const hpa = new k8s.autoscaling.v2.HorizontalPodAutoscaler(
    "web",
    {
      metadata: { name: "web", namespace, labels },
      spec: {
        scaleTargetRef: {
          apiVersion: "apps/v1",
          kind: "Deployment",
          name: deployment.metadata.name,
        },
        minReplicas: cfg.web.minReplicas,
        maxReplicas: cfg.web.maxReplicas,
        metrics: [
          {
            type: "Resource",
            resource: {
              name: "cpu",
              target: {
                type: "Utilization",
                averageUtilization: cfg.web.hpaCpuTargetPercent,
              },
            },
          },
        ],
      },
    },
    { provider, dependsOn: deployment },
  );

  const pdb = installPdb("web", namespace, provider, labels, [deployment]);

  return { deployment, service, hpa, pdb };
}
