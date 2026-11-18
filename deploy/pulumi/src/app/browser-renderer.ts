import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { pullPolicyFor } from "../config/images";
import { commonLabels } from "../platform/namespaces";
import { hardenedContainerSecurityContext } from "../platform/security";
import { type RolloutProfile, gracefulShutdown, surgeRollout } from "../platform/rollout";
import { onNodeGroup, spreadAcrossNodes } from "../platform/scheduling";
import { SCALER_COOLDOWN_SECONDS, SCALER_POLLING_SECONDS } from "./keda-scaling";
import { cpuUtilizationTarget, scaledCpuRequest } from "../config/cpu-requests";

export const BROWSER_RENDERER = {
  name: "browser-renderer",
  port: 9222,
  uid: 10042,
  callers: ["code-runner"] as const,
  workDir: "/tmp",
  workDirSizeLimit: "512Mi",
  resources: {
    requests: { cpu: "500m", memory: "512Mi" },
    limits: { cpu: "2", memory: "1536Mi" },
  },
} as const;

export const LONGEST_SESSION_SECONDS = 190;

export const BROWSER_RENDERER_ROLLOUT: RolloutProfile = {
  minReadySeconds: 10,
  progressDeadlineSeconds: 600,
  terminationGracePeriodSeconds: LONGEST_SESSION_SECONDS + 10,
  endpointDrainSeconds: 5,
};

export const BROWSER_RENDERER_SCALE_BEHAVIOR = {
  scaleUp: { stabilizationWindowSeconds: 0, policies: [{ type: "Percent", value: 100, periodSeconds: 30 }] },
  scaleDown: { stabilizationWindowSeconds: 300, policies: [{ type: "Pods", value: 1, periodSeconds: 60 }] },
} as const;

export function containerSandboxSecurityContext(): k8s.types.input.core.v1.SecurityContext {
  return { ...hardenedContainerSecurityContext(), readOnlyRootFilesystem: true };
}

export interface BrowserRenderer {
  deployment: k8s.apps.v1.Deployment;
  service: k8s.core.v1.Service;
  addr: pulumi.Output<string>;
}

export function browserRendererEnv(addr: pulumi.Input<string> | undefined): k8s.types.input.core.v1.EnvVar[] {
  return addr ? [{ name: "BROWSER_RENDERER_ADDR", value: addr }] : [];
}

export function installBrowserRenderer(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
  imagePullSecrets: { name: string }[],
): BrowserRenderer {
  const { name, port, uid } = BROWSER_RENDERER;
  const labels = commonLabels(name);
  const image = cfg.browserRenderer.image;
  const shutdown = gracefulShutdown(BROWSER_RENDERER_ROLLOUT);

  const deployment = new k8s.apps.v1.Deployment(
    name,
    {
      metadata: { name, namespace, labels },
      spec: {
        replicas: cfg.browserRenderer.minReplicas,
        selector: { matchLabels: labels },
        ...surgeRollout(BROWSER_RENDERER_ROLLOUT),
        template: {
          metadata: { labels },
          spec: {
            enableServiceLinks: false,
            automountServiceAccountToken: false,
            imagePullSecrets,
            terminationGracePeriodSeconds: shutdown.terminationGracePeriodSeconds,
            securityContext: { runAsNonRoot: true, runAsUser: uid, runAsGroup: uid, fsGroup: uid },
            topologySpreadConstraints: spreadAcrossNodes(labels),
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name,
                image,
                imagePullPolicy: pullPolicyFor(image),
                securityContext: containerSandboxSecurityContext(),
                lifecycle: { preStop: { sleep: { seconds: BROWSER_RENDERER_ROLLOUT.endpointDrainSeconds } } },
                ports: [{ containerPort: port, name: "cdp" }],
                env: [
                  { name: "PORT", value: String(port) },
                  { name: "BROWSER_RENDERER_SESSIONS", value: String(cfg.browserRenderer.sessionsPerPod) },
                  { name: "BROWSER_RENDERER_WORK_DIR", value: `${BROWSER_RENDERER.workDir}/browser-renderer` },
                ],
                resources: scaledCpuRequest(BROWSER_RENDERER.resources),
                readinessProbe: { httpGet: { path: "/health", port }, periodSeconds: 10 },
                livenessProbe: {
                  httpGet: { path: "/health", port },
                  initialDelaySeconds: 10,
                  periodSeconds: 20,
                  failureThreshold: 3,
                },
                volumeMounts: [{ name: "tmp", mountPath: BROWSER_RENDERER.workDir }],
              },
            ],
            volumes: [{ name: "tmp", emptyDir: { medium: "Memory", sizeLimit: BROWSER_RENDERER.workDirSizeLimit } }],
          },
        },
      },
    },
    { provider, dependsOn, ignoreChanges: ["spec.replicas"] },
  );

  const service = new k8s.core.v1.Service(
    name,
    {
      metadata: { name, namespace, labels },
      spec: { selector: labels, ports: [{ port, targetPort: port, name: "cdp" }] },
    },
    { provider, dependsOn: deployment },
  );

  return { deployment, service, addr: pulumi.interpolate`${service.spec.clusterIP}:${port}` };
}

export function installBrowserRendererScaling(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  renderer: BrowserRenderer,
  dependsOn: pulumi.Resource[],
): k8s.apiextensions.CustomResource {
  const { name } = BROWSER_RENDERER;
  const { minReplicas, maxReplicas, cpuTargetPercent, memoryTargetPercent } = cfg.browserRenderer;
  return new k8s.apiextensions.CustomResource(
    name,
    {
      apiVersion: "keda.sh/v1alpha1",
      kind: "ScaledObject",
      metadata: { name, namespace, labels: commonLabels(name) },
      spec: {
        scaleTargetRef: { name: renderer.deployment.metadata.name },
        minReplicaCount: minReplicas,
        maxReplicaCount: maxReplicas,
        pollingInterval: SCALER_POLLING_SECONDS,
        cooldownPeriod: SCALER_COOLDOWN_SECONDS,
        advanced: { horizontalPodAutoscalerConfig: { behavior: BROWSER_RENDERER_SCALE_BEHAVIOR } },
        triggers: [
          { type: "cpu", metricType: "Utilization", metadata: { value: String(cpuUtilizationTarget(cpuTargetPercent)) } },
          { type: "memory", metricType: "Utilization", metadata: { value: String(memoryTargetPercent) } },
        ],
      },
    },
    { provider, dependsOn: [renderer.deployment, ...dependsOn] },
  );
}
