import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { IHTTPRouteSpec } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1/HTTPRouteSpec";
import { DeployConfig } from "../config";
import { EDGE_TIMEOUT, LANGFUSE, PORT } from "../constants";
import { GATEWAY_NAME } from "./gateway";
import { LANGFUSE_SECRETS_NAME, LANGFUSE_SECRET_KEYS } from "./langfuse";
import { commonLabels } from "./namespaces";
import { ROLLOUT, gracefulShutdown, secretChecksum, secretChecksumAnnotations, surgeRollout } from "./rollout";
import { onNodeGroup } from "./scheduling";
import {
  MCP_GATEWAY,
  MCP_GATEWAY_PORT,
  MCP_GATEWAY_READINESS_PORT,
  MCP_GATEWAY_STATS_PORT,
  type McpServer,
  credentialPath,
  renderAgentgatewayConfig,
} from "./mcp-gateway-config";

/** The key the session Secret holds; agentgateway reads it as `SESSION_KEY`. */
const SESSION_KEY = "session-key"; // pragma: allowlist secret (Secret key name, not a credential)

/**
 * The MCP servers behind the gateway, each at `/<name>/mcp`. Adding one is an
 * entry here, plus the NetworkPolicy that lets the gateway reach it when its
 * pod is withheld from the namespace-wide allow (`network-policies.ts`).
 */
export function mcpServers(cfg: DeployConfig): McpServer[] {
  return [
    ...(cfg.langfuse.enabled
      ? [
          {
            name: "langfuse",
            url: `http://${LANGFUSE.web}:${PORT.langfuseWeb}/api/public/mcp`,
            // Langfuse's MCP endpoint answers 403 to a Host it does not know.
            // Its docs' first choice is to keep the public one, over listing
            // the internal name in LANGFUSE_MCP_ALLOWED_HOSTS.
            authority: cfg.langfuse.domain,
            // The project key's precomputed `Basic …` header, the one the
            // collector already presents. A project key: it reads and writes
            // that project, prompts included (`ADMITTED_ROLES`).
            credential: { secretName: LANGFUSE_SECRETS_NAME, secretKey: LANGFUSE_SECRET_KEYS.otlpBasicAuth },
            timeout: "300s",
          },
        ]
      : []),
  ];
}

export function mcpGatewayConfigYaml(cfg: DeployConfig): string {
  return renderAgentgatewayConfig({
    origin: `https://${cfg.mcpGateway.domain}`,
    issuer: cfg.mcpGateway.issuer,
    platformOrgId: cfg.mcpGateway.platformOrgId,
    servers: mcpServers(cfg),
    // Its spans go where every other surface's go: through the collector to
    // Langfuse, as service `platform-mcp-gateway` (ADR-0089).
    otlpHttpHost: cfg.observability.enabled ? "otel-collector:4318" : undefined,
  });
}

function credentialVolumes(servers: McpServer[]) {
  const withCredential = servers.filter((s) => s.credential !== undefined);
  return {
    volumes: withCredential.map((s) => ({
      name: `credential-${s.name}`,
      // Only the one key, so the gateway never holds the rest of that Secret.
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
        // Two, so a roll or a lost node leaves one serving. Both hold the same
        // session key, so either one serves any session.
        replicas: 2,
        ...surgeRollout(ROLLOUT.observability),
        selector: { matchLabels: labels },
        template: {
          metadata: {
            labels,
            // agentgateway reloads routes when the file changes, but its
            // `config:` block and SESSION_KEY are read once, at start.
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
                securityContext: {
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                  capabilities: { drop: ["ALL"] },
                },
                resources: {
                  requests: { cpu: "100m", memory: "128Mi" },
                  limits: { cpu: "500m", memory: "256Mi" },
                },
                // The JWKS is fetched as the config loads; until AuthKit
                // answered, the pod is not ready.
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
                ],
              },
            ],
            volumes: [
              { name: "config", configMap: { name: configMap.metadata.name } },
              { name: "tmp", emptyDir: { sizeLimit: "64Mi" } },
              ...credentials.volumes,
            ],
          },
        },
      },
    },
    { provider, dependsOn: [...dependsOn, configMap, sessionSecret] },
  );

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

  const routeSpec: IHTTPRouteSpec = {
    parentRefs: [{ name: GATEWAY_NAME, sectionName: MCP_GATEWAY.listenerName }],
    hostnames: [cfg.mcpGateway.domain],
    rules: [
      {
        backendRefs: [{ name: MCP_GATEWAY.name, port: MCP_GATEWAY_PORT }],
        // A client's SSE stream stays open for the length of a session; the
        // edge budget, as for the app and Langfuse routes.
        timeouts: { request: EDGE_TIMEOUT, backendRequest: EDGE_TIMEOUT },
      },
    ],
  };
  new k8s.apiextensions.CustomResource(
    "platform-mcp-gateway-route",
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: { name: MCP_GATEWAY.routeName, namespace, labels },
      spec: routeSpec,
    },
    // After the Service has endpoints, so the host never answers 503 on a
    // first deploy.
    { provider, dependsOn: [...dependsOn, service] },
  );

  return { deployment, service };
}
