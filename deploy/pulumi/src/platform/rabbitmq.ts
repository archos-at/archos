/**
 * RabbitMQ, Hatchet's message queue (ADR-0150), as Hatchet's high-availability
 * guide describes it: three nodes across nodes, managed by the official RabbitMQ
 * Cluster Kubernetes Operator. Not the Bitnami chart Hatchet bundles: Bitnami's
 * images moved behind a paid catalogue in 2025.
 *
 * The operator is installed from its own release manifest, pinned
 * (`RABBITMQ_OPERATOR_VERSION`), which is how RabbitMQ publishes it; there is
 * no official Helm chart. The manifest's admission webhook takes its
 * certificate from cert-manager (a `Certificate` and a self-signed `Issuer` in
 * `rabbitmq-system`), so it is applied after cert-manager.
 *
 * The cluster's default user is the operator's: it generates the Secret
 * `<cluster>-default-user` (keys `username`, `password`, `host`, `port`), and
 * Hatchet's components read it (`platform/hatchet.ts`).
 */
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { BACKGROUND_WORK } from "../config/background-work";
import { NODE_GROUP_LABEL } from "../constants";
import { scrapeAnnotations } from "./scrape";

/** The operator release the manifest URL names. 2.23.2 was the latest on 2026-11-03. */
export const RABBITMQ_OPERATOR_VERSION = "2.23.2";
export const RABBITMQ_OPERATOR_MANIFEST = `https://github.com/rabbitmq/cluster-operator/releases/download/v${RABBITMQ_OPERATOR_VERSION}/cluster-operator.yml`;
/**
 * The RabbitMQ the cluster runs: the minor Hatchet's own compose file pins at
 * `HATCHET_IMAGE_TAG` (`docker-compose.yml` at v0.114.2: `rabbitmq:4.2.8-management`),
 * at its latest patch (4.2.9, whose base carries the OpenSSL fix 4.2.8's lacks),
 * not the operator's default. Hatchet declares every queue as a classic queue
 * with `x-consumer-timeout`, hardcoded, and RabbitMQ 4.3 accepts that argument
 * only on quorum queues: on the operator's default 4.3.4 every Hatchet component
 * died at boot with `406 PRECONDITION_FAILED - invalid arg 'x-consumer-timeout'`.
 * Move it only with Hatchet, to the minor its compose file names.
 */
export const RABBITMQ_IMAGE = "rabbitmq:4.2.9-management@sha256:d1fb8b38bd0805935907a22b2b7483fba38c9a8dd7e8a74bfba4a6e7a9e91707";
/** The namespace the manifest creates for the operator. */
export const RABBITMQ_OPERATOR_NAMESPACE = "rabbitmq-system";

export const RABBITMQ = {
  /** The `RabbitmqCluster`; the operator names its Service the same and its StatefulSet `<name>-server`. */
  cluster: "hatchet-rabbitmq",
  /** A label of ours on every node pod (`override`), which the PDB, the spread and the network policies select. */
  podLabel: { "background-work/component": "rabbitmq" } as Record<string, string>,
  replicas: 3,
  resources: { requests: { cpu: "500m", memory: "512Mi" }, limits: { cpu: "1", memory: "512Mi" } },
  amqpPort: 5672,
  /** The management API the operator configures the cluster through. */
  managementPort: 15672,
  /** `rabbitmq_prometheus`, which the operator always enables. */
  metricsPort: 15692,
  /** Erlang distribution: peer discovery (epmd) and inter-node traffic. */
  epmdPort: 4369,
  clusteringPort: 25672,
} as const;

/** The Secret the operator generates for the default user. */
export const RABBITMQ_DEFAULT_USER_SECRET = `${RABBITMQ.cluster}-default-user`; // pragma: allowlist secret (a Secret's name)

/** The AMQP Service, by FQDN: `<cluster>.<namespace>.svc`. */
export const RABBITMQ_HOST = `${RABBITMQ.cluster}.${BACKGROUND_WORK.namespace}.svc.cluster.local`;

export function installRabbitmqOperator(provider: k8s.Provider, dependsOn: pulumi.Resource[]): k8s.yaml.v2.ConfigFile {
  return new k8s.yaml.v2.ConfigFile(
    "rabbitmq-cluster-operator",
    { file: RABBITMQ_OPERATOR_MANIFEST },
    { provider, dependsOn },
  );
}

/** The `RabbitmqCluster` spec. Pure, for the spec. */
export function rabbitmqClusterSpec(cfg: DeployConfig) {
  return {
    image: RABBITMQ_IMAGE,
    replicas: RABBITMQ.replicas,
    resources: RABBITMQ.resources,
    persistence: { storageClassName: cfg.storage.className, storage: cfg.backgroundWork.rabbitmq.storageSize },
    // Three nodes on three hosts when the cluster has them: a quorum survives one.
    // On the app group when the stack has groups, as a node affinity because
    // the CRD's pod override would have to restate the containers.
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
  /** The namespace and the operator. */
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
    // The operator owns the PVCs; deleting the CR drops every message in flight.
    { provider, dependsOn, protect: cfg.protectDataResources },
  );
  // One node at a time on a voluntary drain: two of three keep the quorum.
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
