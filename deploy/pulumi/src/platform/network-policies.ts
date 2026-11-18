import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { backendAutoscaled } from '../config/chat-tier'
import { CLAMAV } from "../clamav-constants";
import { EDGE_RATE_LIMIT, GOTENBERG, LANGFUSE, PORT, QDRANT } from "../constants";
import { KEDA_NAMESPACE, KEDA_OPERATOR_LABEL } from "./keda";
import { MCP_GATEWAY, MCP_GATEWAY_PORT } from "./mcp-gateway-config";
import { API_TIERS, CHAT_TIER, CHAT_TIERS } from "../app/tier-names";
import { PUBLIC_SOURCE_FETCHER } from "../app/public-source-fetcher";
import { LOG_SHIPPER } from "../config/observability";
import { HEALTH_PORT, OTLP_GRPC_PORT, OTLP_HTTP_PORT, SHIPPER_OTLP_PORT } from "./collector-config";
import { METRICS_EXPORT_PORT } from "./otel-collector";

const LANGFUSE_WEB = LANGFUSE.web;
const LANGFUSE_WORKER = LANGFUSE.worker;
const CLICKHOUSE = LANGFUSE.clickhouse;

const OTEL_COLLECTOR = "otel-collector";
const OTEL_AGENT_POD = { podSelector: { matchLabels: { "app.kubernetes.io/name": "otel-agent" } } };

export const LANGFUSE_BACKEND_CALLERS = [...CHAT_TIERS, ...API_TIERS, "agent-worker"] as const;

export const QDRANT_CALLERS = [
  ...CHAT_TIERS,
  ...API_TIERS,
  "agent-worker",
  "ingest-worker",
  "ingest-worker-heavy",
  QDRANT.snapshotJob,
  QDRANT.opsLabel,
] as const;

export function installNetworkPolicies(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
): k8s.networking.v1.NetworkPolicy[] {
  const nsLabel = (name: string) => ({
    namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": name } },
  });
  const mk = (
    name: string,
    spec: k8s.types.input.networking.v1.NetworkPolicySpec,
  ): k8s.networking.v1.NetworkPolicy =>
    new k8s.networking.v1.NetworkPolicy(name, { metadata: { name, namespace }, spec }, { provider });

  const deny = mk("default-deny-ingress", {
    podSelector: {},
    policyTypes: ["Ingress"],
  });

  const langfuseWithheld = cfg.langfuse.enabled
    ? [LANGFUSE_WEB, LANGFUSE_WORKER, CLICKHOUSE]
    : [];
  const intra = mk("allow-same-namespace", {
    podSelector: {
      matchExpressions: [
        {
          key: "app.kubernetes.io/name",
          operator: "NotIn",
          values: [
            ...langfuseWithheld,
            ...(cfg.gotenberg.enabled ? [GOTENBERG.name] : []),
            ...(cfg.malwareScan.enabled ? [CLAMAV.name] : []),
            PUBLIC_SOURCE_FETCHER.name,
            QDRANT.name,
            ...(cfg.mcpGateway.enabled ? [MCP_GATEWAY.name] : []),
            ...(cfg.posthog.logsEnabled ? [OTEL_COLLECTOR] : []),
          ],
        },
      ],
    },
    policyTypes: ["Ingress"],
    ingress: [{ from: [{ podSelector: {} }] }],
  });

  const cnpg = mk("allow-cnpg-operator", {
    podSelector: {},
    policyTypes: ["Ingress"],
    ingress: [{ from: [nsLabel("cnpg-system")] }],
  });

  const edgeFrontend = mk("allow-edge-to-frontend", {
    podSelector: { matchLabels: { "app.kubernetes.io/name": "frontend" } },
    policyTypes: ["Ingress"],
    ingress: [
      { from: [nsLabel("envoy-gateway-system")], ports: [{ protocol: "TCP", port: PORT.frontend }] },
    ],
  });

  const edgeS3 = mk("allow-edge-to-seaweedfs", {
    podSelector: { matchLabels: { "app.kubernetes.io/name": "seaweedfs" } },
    policyTypes: ["Ingress"],
    ingress: [
      { from: [nsLabel("envoy-gateway-system")], ports: [{ protocol: "TCP", port: PORT.seaweedS3 }] },
    ],
  });

  const edgeWeb = mk("allow-edge-to-web", {
    podSelector: { matchLabels: { "app.kubernetes.io/name": "web" } },
    policyTypes: ["Ingress"],
    ingress: [
      { from: [nsLabel("envoy-gateway-system")], ports: [{ protocol: "TCP", port: PORT.web }] },
    ],
  });

  const edgeRateLimitStore = cfg.rateLimit.enabled
    ? mk("allow-edge-to-ratelimit-store", {
        podSelector: {
          matchLabels: { "app.kubernetes.io/name": EDGE_RATE_LIMIT.storeService },
        },
        policyTypes: ["Ingress"],
        ingress: [
          {
            from: [nsLabel("envoy-gateway-system")],
            ports: [{ protocol: "TCP", port: PORT.redis }],
          },
        ],
      })
    : undefined;

  const acmeSolver = mk("allow-edge-to-acme-solver", {
    podSelector: { matchLabels: { "acme.cert-manager.io/http01-solver": "true" } },
    policyTypes: ["Ingress"],
    ingress: [{ from: [nsLabel("envoy-gateway-system")] }],
  });

  const edgeLangfuse = cfg.langfuse.enabled
    ? mk("allow-edge-to-langfuse", {
        podSelector: { matchLabels: { "app.kubernetes.io/name": LANGFUSE_WEB } },
        policyTypes: ["Ingress"],
        ingress: [
          {
            from: [nsLabel("envoy-gateway-system")],
            ports: [{ protocol: "TCP", port: PORT.langfuseWeb }],
          },
        ],
      })
    : undefined;

  const collectorToLangfuse = cfg.langfuse.enabled
    ? mk("allow-collector-to-langfuse", {
        podSelector: { matchLabels: { "app.kubernetes.io/name": LANGFUSE_WEB } },
        policyTypes: ["Ingress"],
        ingress: [
          {
            from: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "otel-collector" } } }],
            ports: [{ protocol: "TCP", port: PORT.langfuseWeb }],
          },
        ],
      })
    : undefined;

  const workersToLangfuse = cfg.langfuse.enabled
    ? mk("allow-workers-to-langfuse", {
        podSelector: { matchLabels: { "app.kubernetes.io/name": LANGFUSE_WEB } },
        policyTypes: ["Ingress"],
        ingress: [
          {
            from: ["purger", "bff-jobs"].map((name) => ({
              podSelector: { matchLabels: { "app.kubernetes.io/name": name } },
            })),
            ports: [{ protocol: "TCP", port: PORT.langfuseWeb }],
          },
        ],
      })
    : undefined;

  const frontendToLangfuse = cfg.langfuse.enabled
    ? mk("allow-frontend-to-langfuse", {
        podSelector: { matchLabels: { "app.kubernetes.io/name": LANGFUSE_WEB } },
        policyTypes: ["Ingress"],
        ingress: [
          {
            from: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "frontend" } } }],
            ports: [{ protocol: "TCP", port: PORT.langfuseWeb }],
          },
        ],
      })
    : undefined;

  const backendToLangfuse = cfg.langfuse.enabled
    ? mk("allow-backend-to-langfuse", {
        podSelector: { matchLabels: { "app.kubernetes.io/name": LANGFUSE_WEB } },
        policyTypes: ["Ingress"],
        ingress: [
          {
            from: LANGFUSE_BACKEND_CALLERS.map((name) => ({
              podSelector: { matchLabels: { "app.kubernetes.io/name": name } },
            })),
            ports: [{ protocol: "TCP", port: PORT.langfuseWeb }],
          },
        ],
      })
    : undefined;

  const langfuseToClickhouse = cfg.langfuse.enabled
    ? mk("allow-langfuse-to-clickhouse", {
        podSelector: { matchLabels: { "app.kubernetes.io/name": CLICKHOUSE } },
        policyTypes: ["Ingress"],
        ingress: [
          {
            from: [
              { podSelector: { matchLabels: { "app.kubernetes.io/name": LANGFUSE_WEB } } },
              { podSelector: { matchLabels: { "app.kubernetes.io/name": LANGFUSE_WORKER } } },
            ],
            ports: [
              { protocol: "TCP", port: PORT.clickhouseHttp },
              { protocol: "TCP", port: PORT.clickhouseNative },
            ],
          },
        ],
      })
    : undefined;

  const gotenberg = cfg.gotenberg.enabled
    ? mk("gotenberg-frontend-only", {
        podSelector: { matchLabels: { "app.kubernetes.io/name": GOTENBERG.name } },
        policyTypes: ["Ingress", "Egress"],
        ingress: [
          {
            from: [
              { podSelector: { matchLabels: { "app.kubernetes.io/name": "frontend" } } },
              { podSelector: { matchLabels: { "app.kubernetes.io/name": "bff-jobs" } } },
              ...(cfg.posthog.metricsEnabled ? [OTEL_AGENT_POD] : []),
            ],
            ports: [{ protocol: "TCP", port: PORT.gotenberg }],
          },
        ],
        egress: [],
      })
    : undefined;

  const kedaOperator = [{ ...nsLabel(KEDA_NAMESPACE), podSelector: { matchLabels: { ...KEDA_OPERATOR_LABEL } } }];

  const kedaToBackend = backendAutoscaled(cfg)
    ? mk(`allow-keda-to-${CHAT_TIER}`, {
        podSelector: { matchLabels: { "app.kubernetes.io/name": CHAT_TIER } },
        policyTypes: ["Ingress"],
        ingress: [{ from: kedaOperator, ports: [{ protocol: "TCP", port: PORT.backend }] }],
      })
    : undefined;

  const qdrantPod = { podSelector: { matchLabels: { "app.kubernetes.io/name": QDRANT.name } } };
  const appToQdrant = mk("allow-app-to-qdrant", {
    ...qdrantPod,
    policyTypes: ["Ingress"],
    ingress: [
      {
        from: QDRANT_CALLERS.map((name) => ({
          podSelector: { matchLabels: { "app.kubernetes.io/name": name } },
        })),
        ports: [
          { protocol: "TCP", port: PORT.qdrantHttp },
          { protocol: "TCP", port: PORT.qdrantGrpc },
        ],
      },
    ],
  });
  const qdrantPeers = mk("qdrant-peers", {
    ...qdrantPod,
    policyTypes: ["Ingress"],
    ingress: [
      {
        from: [qdrantPod],
        ports: [
          { protocol: "TCP", port: PORT.qdrantHttp },
          { protocol: "TCP", port: PORT.qdrantGrpc },
          { protocol: "TCP", port: PORT.qdrantP2p },
        ],
      },
    ],
  });

  const collectorToQdrant = cfg.observability.enabled
    ? mk("allow-collector-to-qdrant-metrics", {
        ...qdrantPod,
        policyTypes: ["Ingress"],
        ingress: [
          {
            from: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "otel-collector" } } }],
            ports: [{ protocol: "TCP", port: PORT.qdrantMetrics }],
          },
        ],
      })
    : undefined;

  const edgeQdrant = cfg.qdrant.dashboard.enabled
    ? mk("allow-edge-to-qdrant-dashboard", {
        ...qdrantPod,
        policyTypes: ["Ingress"],
        ingress: [
          {
            from: [nsLabel("envoy-gateway-system")],
            ports: [{ protocol: "TCP", port: PORT.qdrantHttp }],
          },
        ],
      })
    : undefined;

  const logShipperToCollector = cfg.posthog.logsEnabled
    ? mk("allow-log-shipper-to-collector", {
        podSelector: { matchLabels: { "app.kubernetes.io/name": "otel-collector" } },
        policyTypes: ["Ingress"],
        ingress: [
          {
            from: [{ ...nsLabel(LOG_SHIPPER.namespace), podSelector: { matchLabels: { "app.kubernetes.io/name": LOG_SHIPPER.name } } }],
            ports: [{ protocol: "TCP", port: SHIPPER_OTLP_PORT }],
          },
        ],
      })
    : undefined;

  const sameNamespaceToCollector = cfg.posthog.logsEnabled
    ? mk("allow-same-namespace-to-collector", {
        podSelector: { matchLabels: { "app.kubernetes.io/name": OTEL_COLLECTOR } },
        policyTypes: ["Ingress"],
        ingress: [
          {
            from: [{ podSelector: {} }],
            ports: [OTLP_GRPC_PORT, OTLP_HTTP_PORT, HEALTH_PORT, METRICS_EXPORT_PORT].map((port) => ({ protocol: "TCP", port })),
          },
        ],
      })
    : undefined;

  const agentToClickhouse =
    cfg.langfuse.enabled && cfg.posthog.metricsEnabled
      ? mk("allow-agent-to-clickhouse-metrics", {
          podSelector: { matchLabels: { "app.kubernetes.io/name": CLICKHOUSE } },
          policyTypes: ["Ingress"],
          ingress: [{ from: [OTEL_AGENT_POD], ports: [{ protocol: "TCP", port: PORT.clickhouseMetrics }] }],
        })
      : undefined;

  const mcpGatewayPod = { podSelector: { matchLabels: { "app.kubernetes.io/name": MCP_GATEWAY.name } } };
  const edgeMcpGateway = cfg.mcpGateway.enabled
    ? mk("allow-edge-to-platform-mcp-gateway", {
        ...mcpGatewayPod,
        policyTypes: ["Ingress"],
        ingress: [{ from: [nsLabel("envoy-gateway-system")], ports: [{ protocol: "TCP", port: MCP_GATEWAY_PORT }] }],
      })
    : undefined;

  const mcpGatewayToLangfuse =
    cfg.mcpGateway.enabled && cfg.langfuse.enabled
      ? mk("allow-platform-mcp-gateway-to-langfuse", {
          podSelector: { matchLabels: { "app.kubernetes.io/name": LANGFUSE_WEB } },
          policyTypes: ["Ingress"],
          ingress: [{ from: [mcpGatewayPod], ports: [{ protocol: "TCP", port: PORT.langfuseWeb }] }],
        })
      : undefined;

  const clamav = cfg.malwareScan.enabled
    ? mk("clamav-bff-only", {
        podSelector: { matchLabels: { "app.kubernetes.io/name": CLAMAV.name } },
        policyTypes: ["Ingress"],
        ingress: [
          {
            from: [
              { podSelector: { matchLabels: { "app.kubernetes.io/name": "frontend" } } },
              { podSelector: { matchLabels: { "app.kubernetes.io/name": "bff-jobs" } } },
            ],
            ports: [{ protocol: "TCP", port: CLAMAV.port }],
          },
        ],
      })
    : undefined;

  return [
    deny,
    intra,
    cnpg,
    ...(kedaToBackend ? [kedaToBackend] : []),
    edgeFrontend,
    edgeS3,
    edgeWeb,
    ...(edgeRateLimitStore ? [edgeRateLimitStore] : []),
    acmeSolver,
    ...(edgeLangfuse ? [edgeLangfuse] : []),
    ...(collectorToLangfuse ? [collectorToLangfuse] : []),
    ...(workersToLangfuse ? [workersToLangfuse] : []),
    ...(frontendToLangfuse ? [frontendToLangfuse] : []),
    ...(backendToLangfuse ? [backendToLangfuse] : []),
    ...(langfuseToClickhouse ? [langfuseToClickhouse] : []),
    ...(gotenberg ? [gotenberg] : []),
    ...(clamav ? [clamav] : []),
    appToQdrant,
    qdrantPeers,
    ...(collectorToQdrant ? [collectorToQdrant] : []),
    ...(logShipperToCollector ? [logShipperToCollector] : []),
    ...(sameNamespaceToCollector ? [sameNamespaceToCollector] : []),
    ...(edgeQdrant ? [edgeQdrant] : []),
    ...(agentToClickhouse ? [agentToClickhouse] : []),
    ...(edgeMcpGateway ? [edgeMcpGateway] : []),
    ...(mcpGatewayToLangfuse ? [mcpGatewayToLangfuse] : []),
  ];
}
