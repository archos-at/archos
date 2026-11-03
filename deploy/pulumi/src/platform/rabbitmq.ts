/**
 * RabbitMQ, Hatchet's message queue (ADR-0150), as Hatchet's high-availability
 * guide describes it: three nodes across nodes, managed by the official RabbitMQ
 * Cluster Kubernetes Operator. Not the Bitnami chart Hatchet bundles: Bitnami's
 * images moved behind a paid catalogue in 2025.
 *
 * The operator is installed from its own release manifest, pinned
 * (`RABBITMQ_OPERATOR_VERSION`) and vendored beside this file, which is how
 * RabbitMQ publishes it; there is no official Helm chart. The manifest's admission webhook takes its
 * certificate from cert-manager (a `Certificate` and a self-signed `Issuer` in
 * `rabbitmq-system`), so it is applied after cert-manager.
 *
 * The cluster's default user is the operator's: it generates the Secret
 * `<cluster>-default-user` (keys `username`, `password`, `host`, `port`), and
 * Hatchet's components read it (`platform/hatchet.ts`).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { BACKGROUND_WORK } from "../config/background-work";
import { NODE_GROUP_LABEL } from "../constants";
import { loadAll } from "js-yaml";
import { ROLLOUT, surgeRollout } from "./rollout";
import { scrapeAnnotations } from "./scrape";

/** The operator release the manifest URL names. 2.23.2 was the latest on 2026-11-03. */
export const RABBITMQ_OPERATOR_VERSION = "2.23.2";
/**
 * The release manifest, vendored at that version (`cluster-operator.yml` from the
 * GitHub release, sha256 58b74bd5…c773f). In the repo rather than fetched at
 * deploy time, so a plan reads the same bytes every time and the policy-pack
 * patch below is tested against the real file. Bump: download the new release's
 * `cluster-operator.yml` here under its version and change the constant.
 */
export const RABBITMQ_OPERATOR_MANIFEST = resolve(
  __dirname,
  `manifests/rabbitmq-cluster-operator-${RABBITMQ_OPERATOR_VERSION}.yml`,
);
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

export function installRabbitmqOperator(provider: k8s.Provider, dependsOn: pulumi.Resource[]): k8s.yaml.v2.ConfigGroup {
  return new k8s.yaml.v2.ConfigGroup(
    "rabbitmq-cluster-operator",
    { objs: operatorManifest() },
    { provider, dependsOn },
  );
}

/** One object of a Kubernetes manifest, as YAML parses it. */
export type ManifestObject = { kind?: string; spec?: Record<string, unknown>; [field: string]: unknown };

/** The vendored manifest's objects, the operator Deployment gated as below. Pure, for the spec. */
export function operatorManifest(file = RABBITMQ_OPERATOR_MANIFEST): ManifestObject[] {
  const objects = loadAll(readFileSync(file, "utf8")).filter(Boolean) as ManifestObject[];
  return objects.map(gateOperatorRollout);
}

/**
 * Upstream's operator Deployment sets no soak, no progress deadline and no surge
 * strategy, which the policy pack's mandatory `deployment-rollout-gated` and
 * `deployment-no-capacity-dip` refuse: the first staging preview with it failed
 * on exactly that. A manifest's objects are separate resources the pack checks,
 * unlike a Helm release's. The operator elects a leader, so a surged second pod
 * waits its turn.
 */
export function gateOperatorRollout(object: ManifestObject): ManifestObject {
  if (object.kind !== "Deployment") return object;
  return { ...object, spec: { ...object.spec, ...surgeRollout(ROLLOUT.lightWorker) } };
}

/** The `RabbitmqCluster` spec. Pure, for the spec. */
export function rabbitmqClusterSpec(cfg: DeployConfig) {
  return {
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
