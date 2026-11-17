import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { BACKGROUND_WORK } from "../config/background-work";
import { NODE_GROUP_LABEL } from "../constants";
import { scrapeAnnotations } from "./scrape";

// Not the Bitnami chart: its images moved behind a paid catalogue in 2025.
export const RABBITMQ_OPERATOR_VERSION = "2.23.2";
export const RABBITMQ_OPERATOR_MANIFEST = `https://github.com/rabbitmq/cluster-operator/releases/download/v${RABBITMQ_OPERATOR_VERSION}/cluster-operator.yml`;
export const RABBITMQ_IMAGE = "rabbitmq:4.2.9-management@sha256:7fa20d0d23d63ed90499bbf62e24af48ec4ae5eb22d173f3db96e3f85b26884a";
export const RABBITMQ_OPERATOR_NAMESPACE = "rabbitmq-system";

export const RABBITMQ = {
  cluster: "hatchet-rabbitmq",
  podLabel: { "background-work/component": "rabbitmq" } as Record<string, string>,
  replicas: 3,
  resources: { requests: { cpu: "500m", memory: "512Mi" }, limits: { cpu: "1", memory: "512Mi" } },
  amqpPort: 5672,
  managementPort: 15672,
  metricsPort: 15692,
  epmdPort: 4369,
  clusteringPort: 25672,
} as const;

export const RABBITMQ_DEFAULT_USER_SECRET = `${RABBITMQ.cluster}-default-user`; // pragma: allowlist secret (a Secret's name)

export const RABBITMQ_HOST = `${RABBITMQ.cluster}.${BACKGROUND_WORK.namespace}.svc.cluster.local`;

export function installRabbitmqOperator(provider: k8s.Provider, dependsOn: pulumi.Resource[]): k8s.yaml.v2.ConfigFile {
  return new k8s.yaml.v2.ConfigFile(
    "rabbitmq-cluster-operator",
    { file: RABBITMQ_OPERATOR_MANIFEST },
    { provider, dependsOn },
  );
}

export function rabbitmqClusterSpec(cfg: DeployConfig) {
  return {
    image: RABBITMQ_IMAGE,
    replicas: RABBITMQ.replicas,
    resources: RABBITMQ.resources,
    persistence: { storageClassName: cfg.storage.className, storage: cfg.backgroundWork.rabbitmq.storageSize },
    affinity: {
      ...(cfg.nodeGroups.app
        ? {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  { matchExpressions: [{ key: NODE_GROUP_LABEL, operator: "In", values: [cfg.nodeGroups.app] }] },
                ],
              },
            },
          }
        : {}),
      podAntiAffinity: {
        preferredDuringSchedulingIgnoredDuringExecution: [
          {
            weight: 100,
            podAffinityTerm: { topologyKey: "kubernetes.io/hostname", labelSelector: { matchLabels: RABBITMQ.podLabel } },
          },
        ],
      },
    },
    override: {
      statefulSet: {
        spec: {
          template: {
            metadata: { labels: RABBITMQ.podLabel, annotations: scrapeAnnotations(RABBITMQ.metricsPort) },
          },
        },
      },
    },
  };
}

export function installRabbitmq(
  cfg: DeployConfig,
  provider: k8s.Provider,
  dependsOn: pulumi.Resource[],
): { cluster: k8s.apiextensions.CustomResource; pdb: k8s.policy.v1.PodDisruptionBudget } {
  const cluster = new k8s.apiextensions.CustomResource(
    RABBITMQ.cluster,
    {
      apiVersion: "rabbitmq.com/v1beta1",
      kind: "RabbitmqCluster",
      metadata: { name: RABBITMQ.cluster, namespace: BACKGROUND_WORK.namespace },
      spec: rabbitmqClusterSpec(cfg),
    },
    { provider, dependsOn, protect: cfg.protectDataResources },
  );
  const pdb = new k8s.policy.v1.PodDisruptionBudget(
    `${RABBITMQ.cluster}-pdb`,
    {
      metadata: { name: RABBITMQ.cluster, namespace: BACKGROUND_WORK.namespace },
      spec: { maxUnavailable: 1, selector: { matchLabels: RABBITMQ.podLabel } },
    },
    { provider, dependsOn: [cluster] },
  );
  return { cluster, pdb };
}
