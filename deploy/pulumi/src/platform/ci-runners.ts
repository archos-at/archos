import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { CiRunnersConfig } from "../config/ci-runners";
import { NODE_GROUP_LABEL } from "../constants";
import { scaledCpuRequest } from "../config/cpu-requests";
import { cpuMillicores } from "../config/resources";

export const ARC_CHART_VERSION = "0.15.0";
const ARC_CHARTS = "oci://ghcr.io/actions/actions-runner-controller-charts";

export const ARC_SYSTEM_NAMESPACE = "arc-systems";
export const ARC_RUNNERS_NAMESPACE = "arc-runners";
const CONTROLLER_RELEASE = "arc";
const GITHUB_APP_SECRET = "arc-github-app";
export const RUNNER_PRIORITY_CLASS = "ci-runner";
const RUNNER_UID = 1001;
const SCRATCH_DIRS = [
  ["work", "/home/runner/_work"],
  ["cache", "/home/runner/.cache"],
  ["npm", "/home/runner/.npm"],
  ["tmp", "/tmp"],
] as const;

export const CLUSTER_PRIVATE_RANGES = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
  "169.254.0.0/16",
  "127.0.0.0/8",
];

export interface CiRunners {
  controller: k8s.helm.v3.Release;
  scaleSet: k8s.helm.v3.Release;
}

export function installCiRunners(runners: CiRunnersConfig, provider: k8s.Provider): CiRunners {
  const systemNs = namespace(ARC_SYSTEM_NAMESPACE, provider);
  const runnersNs = namespace(ARC_RUNNERS_NAMESPACE, provider);
  installRunnerIsolation(provider, runnersNs);
  const priorityClass = installPriorityClass(provider);

  const controller = new k8s.helm.v3.Release(
    "arc-controller",
    {
      name: CONTROLLER_RELEASE,
      chart: `${ARC_CHARTS}/gha-runner-scale-set-controller`,
      version: ARC_CHART_VERSION,
      namespace: ARC_SYSTEM_NAMESPACE,
      values: {
        resources: scaledCpuRequest({ requests: { cpu: "50m", memory: "128Mi" }, limits: { cpu: "500m", memory: "512Mi" } }),
      },
    },
    { provider, dependsOn: [systemNs] },
  );

  const githubApp = new k8s.core.v1.Secret(
    GITHUB_APP_SECRET,
    {
      metadata: { name: GITHUB_APP_SECRET, namespace: ARC_RUNNERS_NAMESPACE },
      stringData: {
        github_app_id: runners.githubApp.appId,
        github_app_installation_id: runners.githubApp.installationId,
        github_app_private_key: runners.githubApp.privateKey,
      },
    },
    { provider, dependsOn: [runnersNs] },
  );

  const scaleSet = new k8s.helm.v3.Release(
    "arc-scale-set",
    {
      name: runners.scaleSetName,
      chart: `${ARC_CHARTS}/gha-runner-scale-set`,
      version: ARC_CHART_VERSION,
      namespace: ARC_RUNNERS_NAMESPACE,
      values: scaleSetValues(runners, githubApp.metadata.name),
    },
    { provider, dependsOn: [controller, githubApp, priorityClass] },
  );

  return { controller, scaleSet };
}

export function scaleSetValues(runners: CiRunnersConfig, githubAppSecret: pulumi.Input<string>): Record<string, unknown> {
  return {
    githubConfigUrl: runners.githubConfigUrl,
    githubConfigSecret: githubAppSecret,
    runnerScaleSetName: runners.scaleSetName,
    minRunners: runners.minRunners,
    maxRunners: runners.maxRunners,
    controllerServiceAccount: { namespace: ARC_SYSTEM_NAMESPACE, name: `${CONTROLLER_RELEASE}-gha-rs-controller` },
    template: { spec: runnerPodSpec(runners) },
  };
}

function runnerPodSpec(runners: CiRunnersConfig): Record<string, unknown> {
  return {
    automountServiceAccountToken: false,
    priorityClassName: RUNNER_PRIORITY_CLASS,
    securityContext: {
      runAsNonRoot: true,
      runAsUser: RUNNER_UID,
      runAsGroup: RUNNER_UID,
      fsGroup: RUNNER_UID,
      seccompProfile: { type: "RuntimeDefault" },
    },
    ...(runners.nodeGroup ? { nodeSelector: { [NODE_GROUP_LABEL]: runners.nodeGroup } } : {}),
    topologySpreadConstraints: [
      {
        maxSkew: 1,
        topologyKey: "kubernetes.io/hostname",
        whenUnsatisfiable: "ScheduleAnyway",
        labelSelector: { matchLabels: { "actions.github.com/scale-set-name": runners.scaleSetName } },
      },
    ],
    volumes: [
      { name: "shm", emptyDir: { medium: "Memory", sizeLimit: "1Gi" } },
      {
        name: "scratch",
        ephemeral: {
          volumeClaimTemplate: {
            spec: {
              accessModes: ["ReadWriteOnce"],
              storageClassName: runners.scratch.storageClass,
              resources: { requests: { storage: runners.scratch.size } },
            },
          },
        },
      },
    ],
    containers: [
      {
        name: "runner",
        image: runners.image,
        command: ["eatmydata", "/home/runner/run.sh"],
        env: [
          { name: "PYTEST_XDIST_AUTO_NUM_WORKERS", value: String(wholeCores(runners.resources.limits.cpu)) },
          { name: "HOSTNAME", value: "0.0.0.0" },
        ],
        resources: scaledCpuRequest(runners.resources),
        securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
        volumeMounts: [
          { name: "shm", mountPath: "/dev/shm" },
          ...SCRATCH_DIRS.map(([subPath, mountPath]) => ({ name: "scratch", mountPath, subPath })),
        ],
      },
    ],
  };
}

export function wholeCores(cpu: string): number {
  const millicores = cpuMillicores(cpu);
  if (!Number.isFinite(millicores) || millicores <= 0) {
    throw new Error(`grid-oib:ciRunnersLimitsCpu is not a CPU quantity: "${cpu}"`);
  }
  return Math.max(1, Math.floor(millicores / 1000));
}

function installPriorityClass(provider: k8s.Provider): k8s.scheduling.v1.PriorityClass {
  return new k8s.scheduling.v1.PriorityClass(
    RUNNER_PRIORITY_CLASS,
    {
      metadata: { name: RUNNER_PRIORITY_CLASS },
      value: -100,
      preemptionPolicy: "Never",
      globalDefault: false,
    },
    { provider },
  );
}

function namespace(name: string, provider: k8s.Provider): k8s.core.v1.Namespace {
  return new k8s.core.v1.Namespace(
    `${name}-ns`,
    {
      metadata: {
        name,
        labels: {
          "app.kubernetes.io/part-of": "ci-runners",
          "pod-security.kubernetes.io/enforce": "baseline",
        },
      },
    },
    { provider },
  );
}

function installRunnerIsolation(provider: k8s.Provider, runnersNs: k8s.core.v1.Namespace): void {
  new k8s.networking.v1.NetworkPolicy(
    "arc-runners-isolation",
    {
      metadata: { name: "runner-isolation", namespace: ARC_RUNNERS_NAMESPACE },
      spec: {
        podSelector: {},
        policyTypes: ["Ingress", "Egress"],
        ingress: [],
        egress: [
          {
            to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }],
            ports: [
              { protocol: "UDP", port: 53 },
              { protocol: "TCP", port: 53 },
            ],
          },
          { to: [{ ipBlock: { cidr: "0.0.0.0/0", except: CLUSTER_PRIVATE_RANGES } }] },
        ],
      },
    },
    { provider, dependsOn: [runnersNs] },
  );
}
