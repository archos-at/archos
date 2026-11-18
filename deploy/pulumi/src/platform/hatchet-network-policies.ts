import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { BACKGROUND_WORK } from "../config/background-work";
import { API_TIERS, CHAT_TIERS } from "../app/tier-names";
import { PORT } from "../constants";
import { HATCHET, HATCHET_COMPONENTS } from "./hatchet";
import { KEDA_NAMESPACE, KEDA_OPERATOR_LABEL } from "./keda";
import { RABBITMQ, RABBITMQ_OPERATOR_NAMESPACE } from "./rabbitmq";

export const HATCHET_CALLERS = [
  ...CHAT_TIERS,
  ...API_TIERS,
  "agent-worker",
  "ingest-worker",
  "ingest-worker-heavy",
  "frontend",
  "bff-jobs",
] as const;

const byName = (name: string) => ({ podSelector: { matchLabels: { "app.kubernetes.io/name": name } } });
const inNamespace = (ns: pulumi.Input<string>) => ({
  namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": ns } },
});

export function installHatchetNetworkPolicies(
  cfg: DeployConfig,
  provider: k8s.Provider,
  appNamespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
): k8s.networking.v1.NetworkPolicy[] {
  const namespace = BACKGROUND_WORK.namespace;
  const mk = (name: string, spec: k8s.types.input.networking.v1.NetworkPolicySpec) =>
    new k8s.networking.v1.NetworkPolicy(
      `background-work-${name}`,
      { metadata: { name, namespace }, spec },
      { provider, dependsOn },
    );
  const pgPods = { podSelector: { matchLabels: { "cnpg.io/cluster": BACKGROUND_WORK.cluster } } };
  const fromApp = (name: string) => ({ ...inNamespace(appNamespace), ...byName(name) });
  const [[rabbitmqKey, rabbitmqValue]] = Object.entries(RABBITMQ.podLabel);

  const policies = [
    mk("default-deny-ingress", { podSelector: {}, policyTypes: ["Ingress"] }),
    mk("allow-same-namespace", {
      podSelector: { matchExpressions: [{ key: rabbitmqKey, operator: "NotIn", values: [rabbitmqValue] }] },
      policyTypes: ["Ingress"],
      ingress: [{ from: [{ podSelector: {} }] }],
    }),
    mk("allow-hatchet-to-rabbitmq", {
      podSelector: { matchLabels: RABBITMQ.podLabel },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: Object.values(HATCHET_COMPONENTS).map(byName),
          ports: [{ protocol: "TCP", port: RABBITMQ.amqpPort }],
        },
      ],
    }),
    mk("rabbitmq-peers", {
      podSelector: { matchLabels: RABBITMQ.podLabel },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [{ podSelector: { matchLabels: RABBITMQ.podLabel } }],
          ports: [RABBITMQ.amqpPort, RABBITMQ.epmdPort, RABBITMQ.clusteringPort, RABBITMQ.managementPort].map((port) => ({
            protocol: "TCP",
            port,
          })),
        },
      ],
    }),
    mk("allow-rabbitmq-operator", {
      podSelector: { matchLabels: RABBITMQ.podLabel },
      policyTypes: ["Ingress"],
      ingress: [{ from: [inNamespace(RABBITMQ_OPERATOR_NAMESPACE)], ports: [{ protocol: "TCP", port: RABBITMQ.managementPort }] }],
    }),
    mk("allow-cnpg-operator", { podSelector: {}, policyTypes: ["Ingress"], ingress: [{ from: [inNamespace("cnpg-system")] }] }),
    mk("allow-app-to-hatchet-grpc", {
      ...byName(HATCHET_COMPONENTS.grpc),
      policyTypes: ["Ingress"],
      ingress: [{ from: HATCHET_CALLERS.map(fromApp), ports: [{ protocol: "TCP", port: HATCHET.grpcPort }] }],
    }),
    mk("allow-app-to-hatchet-api", {
      ...byName(HATCHET_COMPONENTS.api),
      policyTypes: ["Ingress"],
      ingress: [{ from: HATCHET_CALLERS.map(fromApp), ports: [{ protocol: "TCP", port: HATCHET.apiPort }] }],
    }),
    mk("allow-keda-to-postgres", {
      ...pgPods,
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [{ ...inNamespace(KEDA_NAMESPACE), podSelector: { matchLabels: { ...KEDA_OPERATOR_LABEL } } }],
          ports: [{ protocol: "TCP", port: PORT.postgres }],
        },
      ],
    }),
  ];
  if (cfg.posthog.metricsEnabled) {
    const agent = { ...inNamespace(appNamespace), ...byName("otel-agent") };
    policies.push(
      mk("allow-agent-to-hatchet-metrics", {
        podSelector: {
          matchExpressions: [
            {
              key: "app.kubernetes.io/name",
              operator: "In",
              values: [HATCHET_COMPONENTS.grpc, HATCHET_COMPONENTS.controllers, HATCHET_COMPONENTS.scheduler],
            },
          ],
        },
        policyTypes: ["Ingress"],
        ingress: [{ from: [agent], ports: [{ protocol: "TCP", port: HATCHET.metricsPort }] }],
      }),
      mk("allow-agent-to-rabbitmq-metrics", {
        podSelector: { matchLabels: RABBITMQ.podLabel },
        policyTypes: ["Ingress"],
        ingress: [{ from: [agent], ports: [{ protocol: "TCP", port: RABBITMQ.metricsPort }] }],
      }),
      mk("allow-agent-to-postgres-metrics", {
        ...pgPods,
        policyTypes: ["Ingress"],
        ingress: [{ from: [agent], ports: [{ protocol: "TCP", port: PORT.postgresMetrics }] }],
      }),
    );
  }
  return policies;
}
