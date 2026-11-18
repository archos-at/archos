import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { pullPolicyFor } from "../config/images";
import { commonLabels } from "../platform/namespaces";
import { type RolloutProfile, gracefulShutdown, surgeRollout } from "../platform/rollout";
import { installPdb, onNodeGroup, spreadAcrossNodes } from "../platform/scheduling";
import { hardenedContainerSecurityContext } from "../platform/security";
import { SCALER_COOLDOWN_SECONDS, SCALER_POLLING_SECONDS } from "./keda-scaling";
import { CHAT_TIERS } from "./tier-names";

type EnvVar = k8s.types.input.core.v1.EnvVar;

export const CODE_RUNNER = {
  name: "code-runner",
  port: 8080,
  uid: 1000,
  callers: [...CHAT_TIERS, "agent-worker"] as const,
  workDir: "/run/code-runner/do",
  workDirSizeLimit: "1Gi",
  tmpSizeLimit: "64Mi",
  resources: {
    requests: { cpu: "1", memory: "1Gi" },
    limits: { cpu: "2", memory: "2Gi" },
  },
} as const;

export const LONGEST_RUN_SECONDS = 180;

export const CODE_RUNNER_ROLLOUT: RolloutProfile = {
  minReadySeconds: 10,
  progressDeadlineSeconds: 600,
  terminationGracePeriodSeconds: LONGEST_RUN_SECONDS + 20,
  endpointDrainSeconds: 5,
};

export const CODE_RUNNER_SCALE_BEHAVIOR = {
  scaleUp: { stabilizationWindowSeconds: 0, policies: [{ type: "Percent", value: 100, periodSeconds: 30 }] },
  scaleDown: { stabilizationWindowSeconds: 300, policies: [{ type: "Pods", value: 1, periodSeconds: 60 }] },
} as const;

export function codeRunnerUrl(): string {
  return `http://${CODE_RUNNER.name}:${CODE_RUNNER.port}`;
}

export function codeRunnerEnv(url: pulumi.Input<string> | undefined): EnvVar[] {
  return url ? [{ name: "CODE_RUNNER_URL", value: url }] : [];
}

export interface CodeRunner {
  deployment: k8s.apps.v1.Deployment;
  service: k8s.core.v1.Service;
  pdb: k8s.policy.v1.PodDisruptionBudget;
  url: pulumi.Output<string>;
}

export function installCodeRunner(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
  imagePullSecrets: { name: string }[],
): CodeRunner {
  const { name, port, uid } = CODE_RUNNER;
  const labels = commonLabels(name);
  const image = cfg.codeRunner.image;
  const shutdown = gracefulShutdown(CODE_RUNNER_ROLLOUT);

  const deployment = new k8s.apps.v1.Deployment(
    name,
    {
      metadata: { name, namespace, labels },
      spec: {
        replicas: cfg.codeRunner.minReplicas,
        selector: { matchLabels: labels },
        ...surgeRollout(CODE_RUNNER_ROLLOUT),
        template: {
          metadata: { labels },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
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
                securityContext: { ...hardenedContainerSecurityContext(), readOnlyRootFilesystem: true },
                lifecycle: { preStop: { sleep: { seconds: CODE_RUNNER_ROLLOUT.endpointDrainSeconds } } },
                ports: [{ containerPort: port, name: "http" }],
                resources: CODE_RUNNER.resources,
                readinessProbe: { httpGet: { path: "/health", port }, periodSeconds: 10 },
                livenessProbe: {
                  httpGet: { path: "/health", port },
                  initialDelaySeconds: 10,
                  periodSeconds: 20,
                  failureThreshold: 3,
                },
                volumeMounts: [
                  { name: "work", mountPath: CODE_RUNNER.workDir },
                  { name: "tmp", mountPath: "/tmp" },
                ],
              },
            ],
            volumes: [
              { name: "work", emptyDir: { medium: "Memory", sizeLimit: CODE_RUNNER.workDirSizeLimit } },
              { name: "tmp", emptyDir: { sizeLimit: CODE_RUNNER.tmpSizeLimit } },
            ],
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
      spec: { selector: labels, ports: [{ port, targetPort: port, name: "http" }] },
    },
    { provider, dependsOn: deployment },
  );

  const pdb = installPdb(name, namespace, provider, labels, [deployment]);

  return { deployment, service, pdb, url: pulumi.output(codeRunnerUrl()) };
}

export function installCodeRunnerScaling(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  runner: CodeRunner,
  dependsOn: pulumi.Resource[],
): k8s.apiextensions.CustomResource {
  const { name } = CODE_RUNNER;
  const { minReplicas, maxReplicas, cpuTargetPercent, memoryTargetPercent } = cfg.codeRunner;
  return new k8s.apiextensions.CustomResource(
    name,
    {
      apiVersion: "keda.sh/v1alpha1",
      kind: "ScaledObject",
      metadata: { name, namespace, labels: commonLabels(name) },
      spec: {
        scaleTargetRef: { name: runner.deployment.metadata.name },
        minReplicaCount: minReplicas,
        maxReplicaCount: maxReplicas,
        pollingInterval: SCALER_POLLING_SECONDS,
        cooldownPeriod: SCALER_COOLDOWN_SECONDS,
        advanced: { horizontalPodAutoscalerConfig: { behavior: CODE_RUNNER_SCALE_BEHAVIOR } },
        triggers: [
          { type: "cpu", metricType: "Utilization", metadata: { value: String(cpuTargetPercent) } },
          { type: "memory", metricType: "Utilization", metadata: { value: String(memoryTargetPercent) } },
        ],
      },
    },
    { provider, dependsOn: [runner.deployment, ...dependsOn] },
  );
}
