import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { IHTTPRouteSpec } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1/HTTPRouteSpec";
import type { IBackendTrafficPolicySpec } from "@kubernetes-models/envoy-gateway/gateway.envoyproxy.io/v1alpha1/BackendTrafficPolicySpec";
import { edgeRateLimit, edgeRetry, perClientRules } from "../app/httproutes";
import { DeployConfig } from "../config";
import { EDGE_TIMEOUT, LANGFUSE, PORT } from "../constants";
import { CMS_GATEWAY_CREDENTIAL_KEY, CMS_GATEWAY_CREDENTIAL_SECRET, CMS_INTERNAL_URL } from "./cms";
import { formerMcpGatewayHost } from "../app/former-domain";
import { GATEWAY_NAME } from "./gateway";
import { LANGFUSE_SECRETS_NAME, LANGFUSE_SECRET_KEYS } from "./langfuse";
import { commonLabels } from "./namespaces";
import { ROLLOUT, gracefulShutdown, secretChecksum, secretChecksumAnnotations, surgeRollout } from "./rollout";
import { installPdb, onNodeGroup, spreadAcrossNodes } from "./scheduling";
import {
  MCP_GATEWAY,
  MCP_GATEWAY_PORT,
  MCP_GATEWAY_READINESS_PORT,
  MCP_GATEWAY_STATS_PORT,
  type McpServer,
  credentialPath,
  renderAgentgatewayConfig,
  resourceUrl,
} from "./mcp-gateway-config";

const RATE_PER_MINUTE = 300;
const DRAIN_SECONDS = 5;

const SESSION_KEY = "session-key"; // pragma: allowlist secret (Secret key name, not a credential)

export const LANGFUSE_PLATFORM_TOOLS = [
  "getPrompt",
  "getPromptUnresolved",
  "listPrompts",
  "getSkill",
  "listSkills",
  "loadSkill",
  "loadSkillResource",
  "createSkillVersion",
  "updateSkillLabels",
  "updateSkillTags",
  "listModels",
  "getModel",
  "createModel",
  "deleteModel",
  "listScoreConfigs",
  "getScoreConfig",
  "createScoreConfig",
  "updateScoreConfig",
  "deleteScoreConfig",
  "listEvaluators",
  "getEvaluator",
  "listManagedEvaluatorTemplates",
  "listEvaluationRules",
  "getEvaluationRule",
  "listLlmConnections",
  "getHealth",
] as const;

export const LANGFUSE_TRACE_TOOLS = {
  pinned: ["listObservations"],
  schema: ["getObservationFilterSchema", "getObservationFieldSchema"],
  unpinnable: ["getObservation", "getObservationFilterValues"],
} as const;

export const orgTraceTag = (organizationId: string): string => `org:${organizationId}`;

function langfuseTools(traceOrgs: "all" | readonly string[]): Pick<McpServer, "tools" | "pinnedToTags"> {
  if (traceOrgs === "all") {
    return {
      tools: [
        ...LANGFUSE_PLATFORM_TOOLS,
        ...LANGFUSE_TRACE_TOOLS.pinned,
        ...LANGFUSE_TRACE_TOOLS.schema,
        ...LANGFUSE_TRACE_TOOLS.unpinnable,
      ],
    };
  }
  if (traceOrgs.length === 0) return { tools: LANGFUSE_PLATFORM_TOOLS };
  return {
    tools: [...LANGFUSE_PLATFORM_TOOLS, ...LANGFUSE_TRACE_TOOLS.pinned, ...LANGFUSE_TRACE_TOOLS.schema],
    pinnedToTags: { tools: LANGFUSE_TRACE_TOOLS.pinned, tags: traceOrgs.map(orgTraceTag) },
  };
}

export function mcpServers(cfg: DeployConfig): McpServer[] {
  return [
    ...(cfg.langfuse.enabled
      ? [
          {
            name: "langfuse",
            url: `http://${LANGFUSE.web}:${PORT.langfuseWeb}/api/public/mcp`,
            authority: cfg.langfuse.domain,
            credential: { secretName: LANGFUSE_SECRETS_NAME, secretKey: LANGFUSE_SECRET_KEYS.otlpBasicAuth },
            timeout: "300s",
            ...langfuseTools(cfg.mcpGateway.langfuseTraceOrgs),
          },
        ]
      : []),
    ...(cfg.cms.enabled
      ? [
          {
            name: "cms",
            url: `${CMS_INTERNAL_URL}/api/mcp`,
            credential: { secretName: CMS_GATEWAY_CREDENTIAL_SECRET, secretKey: CMS_GATEWAY_CREDENTIAL_KEY },
            timeout: "120s",
            tools: "all" as const,
          },
        ]
      : []),
  ];
}

export function platformMcpServerEnv(cfg: DeployConfig): k8s.types.input.core.v1.EnvVar[] {
  if (!cfg.mcpGateway.enabled) return [];
  const urls = mcpServers(cfg).map((server) => resourceUrl(`https://${cfg.mcpGateway.domain}`, server));
  return [
    { name: "PLATFORM_MCP_SERVER_URLS", value: urls.join(",") },
    {
      name: "PLATFORM_MCP_ADMISSION_TOKEN",
      valueFrom: { secretKeyRef: { name: MCP_GATEWAY.admissionSecret, key: ADMISSION_KEY } },
    },
  ];
}

export function mcpGatewayConfigYaml(cfg: DeployConfig): string {
  const former = formerMcpGatewayHost(cfg.ingress, cfg.mcpGateway);
  return renderAgentgatewayConfig({
    origin: `https://${cfg.mcpGateway.domain}`,
    formerOrigins: former ? [`https://${former.from}`] : [],
    issuer: cfg.mcpGateway.issuer,
    platformOrgId: cfg.mcpGateway.platformOrgId,
    servers: mcpServers(cfg),
    otlpHttpHost: cfg.observability.enabled ? "otel-collector:4318" : undefined,
    admission: { host: `frontend:${PORT.frontend}`, tokenFile: ADMISSION_TOKEN_FILE },
  });
}

const ADMISSION_TOKEN_FILE = "/var/run/secrets/mcp/admission/token";
const ADMISSION_KEY = "token"; // pragma: allowlist secret (Secret key name, not a credential)

export function installMcpAdmissionSecret(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
): k8s.core.v1.Secret | undefined {
  if (!cfg.mcpGateway.enabled) return undefined;
  return new k8s.core.v1.Secret(
    MCP_GATEWAY.admissionSecret,
    {
      metadata: { name: MCP_GATEWAY.admissionSecret, namespace, labels: commonLabels(MCP_GATEWAY.name) },
      stringData: { [ADMISSION_KEY]: cfg.mcpGateway.admissionToken },
    },
    { provider },
  );
}

function credentialVolumes(servers: McpServer[]) {
  const withCredential = servers.filter((s) => s.credential !== undefined);
  return {
    volumes: withCredential.map((s) => ({
      name: `credential-${s.name}`,
      secret: { secretName: s.credential!.secretName, items: [{ key: s.credential!.secretKey, path: "authorization" }] },
    })),
    mounts: withCredential.map((s) => ({
      name: `credential-${s.name}`,
      mountPath: credentialPath(s).replace(/\/authorization$/, ""),
      readOnly: true,
    })),
  };
}

export function installMcpGateway(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
): { deployment: k8s.apps.v1.Deployment; service: k8s.core.v1.Service } {
  const labels = commonLabels(MCP_GATEWAY.name);
  const servers = mcpServers(cfg);
  const configYaml = mcpGatewayConfigYaml(cfg);
  const credentials = credentialVolumes(servers);

  const sessionSecret = new k8s.core.v1.Secret(
    MCP_GATEWAY.sessionSecret,
    {
      metadata: { name: MCP_GATEWAY.sessionSecret, namespace, labels },
      stringData: { [SESSION_KEY]: cfg.mcpGateway.sessionKey },
    },
    { provider },
  );
  const configMap = new k8s.core.v1.ConfigMap(
    MCP_GATEWAY.configMap,
    { metadata: { name: MCP_GATEWAY.configMap, namespace, labels }, data: { "config.yaml": configYaml } },
    { provider },
  );

  const deployment = new k8s.apps.v1.Deployment(
    MCP_GATEWAY.name,
    {
      metadata: { name: MCP_GATEWAY.name, namespace, labels },
      spec: {
        replicas: 2,
        ...surgeRollout(ROLLOUT.observability),
        selector: { matchLabels: labels },
        template: {
          metadata: {
            labels,
            annotations: secretChecksumAnnotations(
              secretChecksum({ "config.yaml": configYaml, [SESSION_KEY]: cfg.mcpGateway.sessionKey }),
            ),
          },
          spec: {
            enableServiceLinks: false,
            automountServiceAccountToken: false,
            securityContext: { runAsNonRoot: true, runAsUser: MCP_GATEWAY.uid, runAsGroup: MCP_GATEWAY.uid },
            terminationGracePeriodSeconds: gracefulShutdown(ROLLOUT.observability).terminationGracePeriodSeconds,
            ...onNodeGroup(cfg.nodeGroups.app),
            topologySpreadConstraints: spreadAcrossNodes(labels),
            containers: [
              {
                name: "agentgateway",
                image: MCP_GATEWAY.image,
                imagePullPolicy: "IfNotPresent",
                args: ["-f", "/config/config.yaml"],
                env: [
                  {
                    name: "SESSION_KEY",
                    valueFrom: { secretKeyRef: { name: sessionSecret.metadata.name, key: SESSION_KEY } },
                  },
                ],
                ports: [
                  { name: "http", containerPort: MCP_GATEWAY_PORT },
                  { name: "metrics", containerPort: MCP_GATEWAY_STATS_PORT },
                  { name: "readiness", containerPort: MCP_GATEWAY_READINESS_PORT },
                ],
                lifecycle: { preStop: { sleep: { seconds: DRAIN_SECONDS } } },
                securityContext: {
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                  capabilities: { drop: ["ALL"] },
                },
                resources: {
                  requests: { cpu: "100m", memory: "128Mi" },
                  limits: { cpu: "500m", memory: "256Mi" },
                },
                startupProbe: {
                  httpGet: { path: "/healthz/ready", port: MCP_GATEWAY_READINESS_PORT },
                  periodSeconds: 2,
                  failureThreshold: 60,
                  timeoutSeconds: 2,
                },
                readinessProbe: {
                  httpGet: { path: "/healthz/ready", port: MCP_GATEWAY_READINESS_PORT },
                  periodSeconds: 10,
                  timeoutSeconds: 2,
                },
                volumeMounts: [
                  { name: "config", mountPath: "/config", readOnly: true },
                  { name: "tmp", mountPath: "/tmp" },
                  ...credentials.mounts,
                  { name: "admission", mountPath: ADMISSION_TOKEN_FILE.replace(/\/token$/, ""), readOnly: true },
                ],
              },
            ],
            volumes: [
              { name: "config", configMap: { name: configMap.metadata.name } },
              { name: "tmp", emptyDir: { sizeLimit: "64Mi" } },
              ...credentials.volumes,
              { name: "admission", secret: { secretName: MCP_GATEWAY.admissionSecret, items: [{ key: ADMISSION_KEY, path: "token" }] } },
            ],
          },
        },
      },
    },
    { provider, dependsOn: [...dependsOn, configMap, sessionSecret] },
  );

  installPdb(MCP_GATEWAY.name, namespace, provider, labels, [deployment]);

  const service = new k8s.core.v1.Service(
    MCP_GATEWAY.name,
    {
      metadata: { name: MCP_GATEWAY.name, namespace, labels },
      spec: {
        selector: labels,
        ports: [
          { name: "http", port: MCP_GATEWAY_PORT, targetPort: MCP_GATEWAY_PORT },
          { name: "metrics", port: MCP_GATEWAY_STATS_PORT, targetPort: MCP_GATEWAY_STATS_PORT },
        ],
      },
    },
    { provider, dependsOn: [deployment] },
  );

  const former = formerMcpGatewayHost(cfg.ingress, cfg.mcpGateway);
  const routeSpec: IHTTPRouteSpec = {
    parentRefs: [
      { name: GATEWAY_NAME, sectionName: MCP_GATEWAY.listenerName },
      ...(former ? [{ name: GATEWAY_NAME, sectionName: former.listener }] : []),
    ],
    hostnames: [cfg.mcpGateway.domain, ...(former ? [former.from] : [])],
    rules: [
      {
        backendRefs: [{ name: MCP_GATEWAY.name, port: MCP_GATEWAY_PORT }],
        timeouts: { request: EDGE_TIMEOUT, backendRequest: EDGE_TIMEOUT },
      },
    ],
  };
  const trafficSpec: IBackendTrafficPolicySpec = {
    targetRefs: [{ group: "gateway.networking.k8s.io", kind: "HTTPRoute", name: MCP_GATEWAY.routeName }],
    retry: edgeRetry,
    ...edgeRateLimit(cfg, perClientRules(cfg, RATE_PER_MINUTE)),
  };
  new k8s.apiextensions.CustomResource(
    "platform-mcp-gateway-traffic-policy",
    {
      apiVersion: "gateway.envoyproxy.io/v1alpha1",
      kind: "BackendTrafficPolicy",
      metadata: { name: MCP_GATEWAY.routeName, namespace, labels },
      spec: trafficSpec,
    },
    { provider, dependsOn },
  );

  new k8s.apiextensions.CustomResource(
    "platform-mcp-gateway-route",
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: { name: MCP_GATEWAY.routeName, namespace, labels },
      spec: routeSpec,
    },
    { provider, dependsOn: [...dependsOn, service] },
  );

  return { deployment, service };
}
