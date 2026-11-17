import * as yaml from "js-yaml";

export const MCP_GATEWAY_PORT = 8080;
export const MCP_GATEWAY_STATS_PORT = 15020;
export const MCP_GATEWAY_READINESS_PORT = 15021;

export const MCP_GATEWAY = {
  name: "platform-mcp-gateway",
  listenerName: "https-platform-mcp",
  tlsSecret: "platform-mcp-tls", // pragma: allowlist secret (Kubernetes Secret resource name, not a credential)
  routeName: "platform-mcp-gateway",
  configMap: "platform-mcp-gateway-config",
  sessionSecret: "platform-mcp-gateway-session", // pragma: allowlist secret (Kubernetes Secret resource name, not a credential)
  admissionSecret: "platform-mcp-admission", // pragma: allowlist secret (Kubernetes Secret resource name, not a credential)
  image: "cr.agentgateway.dev/agentgateway:v1.7.0@sha256:60216aafb03d37f94e952ff3d51d2f630a65b10ecaebdc0a864882f92610c45b",
  uid: 65532,
} as const;

export const ADMITTED_ROLES = ["org-platform-owner"] as const;

export interface McpServer {
  name: string;
  url: string;
  authority?: string;
  credential?: { secretName: string; secretKey: string };
  timeout: string;
  tools: "all" | readonly string[];
  pinnedToTags?: { tools: readonly string[]; tags: readonly string[] };
}

export interface McpGatewaySettings {
  origin: string;
  formerOrigins?: readonly string[];
  issuer: string;
  platformOrgId: string;
  servers: readonly McpServer[];
  otlpHttpHost?: string;
  admission?: { host: string; tokenFile: string };
}

export const ADMISSION_PATH = "/api/internal/platform-mcp-admission";

export function credentialPath(server: McpServer): string {
  return `/var/run/secrets/mcp/${server.name}/authorization`;
}

export function resourceUrl(origin: string, server: McpServer): string {
  return `${origin}/${server.name}/mcp`;
}

export function toolAllowlist(server: McpServer): Record<string, unknown> | undefined {
  if (server.tools === "all") return undefined;
  for (const tool of server.tools) {
    if (!/^[A-Za-z0-9_.-]+$/.test(tool)) throw new Error(`Not a tool name agentgateway can match literally: ${tool}`);
  }
  return { rules: [{ allow: `mcp.tool.name in [${server.tools.map((tool) => `"${tool}"`).join(", ")}]` }] };
}

const LITERAL = /^[A-Za-z0-9_.:-]+$/;

export function tagPinGuardrails(server: McpServer): Record<string, unknown> | undefined {
  const pin = server.pinnedToTags;
  if (!pin || pin.tools.length === 0) return undefined;
  for (const literal of [...pin.tools, ...pin.tags]) {
    if (!LITERAL.test(literal)) throw new Error(`Not a literal a CEL rule can hold: ${literal}`);
  }
  if (pin.tags.length === 0) throw new Error(`${server.name}: a pinned tool needs at least one tag to pin to.`);
  const list = (values: readonly string[]) => `[${values.map((v) => `"${v}"`).join(", ")}]`;
  const pinned =
    "has(mcp.params.arguments) && has(mcp.params.arguments.filter) && " +
    "mcp.params.arguments.filter.exists(f, has(f.column) && f.column == \"tags\" && " +
    "has(f.operator) && f.operator in [\"any of\", \"all of\"] && " +
    `has(f.value) && size(f.value) > 0 && f.value.all(v, v in ${list(pin.tags)}))`;
  return {
    processors: [
      {
        kind: "expression",
        methods: { "tools/call": "request" },
        condition: `mcp.params.name in ${list(pin.tools.flatMap((t) => [t, `${server.name}_${t}`]))} && !(${pinned})`,
        reject:
          `Pin this call to the traces you may read: a filter {"column": "tags", "operator": "any of", "value": [...]} ` +
          `with values among ${pin.tags.join(", ")}.`,
      },
    ],
  };
}

function otherOrganization(platformOrgId: string): string {
  return `!request.path.startsWith("/.well-known/") && jwt.org_id != "${platformOrgId}"`;
}

export function admissionRule(platformOrgId: string, admission = false): string {
  const roles = ADMITTED_ROLES.map((role) => `"${role}" in jwt.roles`).join(" || ");
  const platform = `(jwt.org_id == "${platformOrgId}" && (${roles}))`;
  const decidedByApp = admission ? ` || (${otherOrganization(platformOrgId)})` : "";
  return `request.path.startsWith("/.well-known/") || ${platform}${decidedByApp}`;
}

function otherOrganizationAdmission(settings: McpGatewaySettings): Record<string, unknown> | undefined {
  if (!settings.admission) return undefined;
  const roles = ADMITTED_ROLES.map((role) => `role=${encodeURIComponent(role)}`).join("&");
  return {
    conditional: [
      {
        condition: otherOrganization(settings.platformOrgId),
        host: settings.admission.host,
        protocol: { http: { path: `"${ADMISSION_PATH}?${roles}"` } },
        includeRequestHeaders: ["authorization"],
        failureMode: "deny",
        policies: {
          backendAuth: {
            key: {
              value: { file: settings.admission.tokenFile },
              location: { header: { name: "x-internal-token", prefix: "" } },
            },
          },
        },
        cache: { key: ["jwt.sub"], ttl: 'duration("60s")' },
      },
    ],
  };
}

function route(settings: McpGatewaySettings, server: McpServer, origin: string): Record<string, unknown> {
  const path = `/${server.name}/mcp`;
  const resource = resourceUrl(origin, server);
  const former = origin !== settings.origin;
  const audiences = [settings.origin, ...(settings.formerOrigins ?? [])].map((o) => resourceUrl(o, server));
  const target: Record<string, unknown> = {
    name: server.name,
    mcp: { host: server.url },
    policies: {
      ...(server.credential
        ? {
            backendAuth: {
              key: {
                value: { file: credentialPath(server) },
                location: { header: { name: "authorization", prefix: "" } },
              },
            },
          }
        : {}),
      http: { requestTimeout: server.timeout },
    },
  };
  return {
    name: former ? `${server.name}-${new URL(origin).hostname.replace(/\./g, "-")}` : server.name,
    ...(former ? { hostnames: [new URL(origin).hostname] } : {}),
    matches: [
      { path: { exact: path } },
      { path: { exact: `/.well-known/oauth-protected-resource${path}` } },
    ],
    policies: {
      mcpAuthentication: {
        mode: "strict",
        issuer: settings.issuer,
        audiences,
        jwks: { url: `${settings.issuer}/oauth2/jwks` },
        resourceMetadata: {
          resource,
          scopesSupported: ["openid", "profile", "email", "offline_access"],
          bearerMethodsSupported: ["header"],
        },
      },
      ...(otherOrganizationAdmission(settings) ? { extAuthz: otherOrganizationAdmission(settings) } : {}),
      authorization: { rules: [{ require: admissionRule(settings.platformOrgId, settings.admission !== undefined) }] },
      ...(toolAllowlist(server) ? { mcpAuthorization: toolAllowlist(server) } : {}),
      ...(tagPinGuardrails(server) ? { mcpGuardrails: tagPinGuardrails(server) } : {}),
      ...(server.authority ? { urlRewrite: { authority: { full: server.authority } } } : {}),
    },
    backends: [{ mcp: { statefulMode: "stateful", targets: [target] } }],
  };
}

export function agentgatewayConfig(settings: McpGatewaySettings): Record<string, unknown> {
  return {
    config: {
      adminAddr: "localhost:15000",
      statsAddr: `0.0.0.0:${MCP_GATEWAY_STATS_PORT}`,
      readinessAddr: `0.0.0.0:${MCP_GATEWAY_READINESS_PORT}`,
      logging: { format: "json" },
    },
    ...(settings.otlpHttpHost
      ? {
          frontendPolicies: {
            tracing: {
              host: settings.otlpHttpHost,
              protocol: "http",
              randomSampling: "true",
              filter: 'jwt.sub != ""',
              resources: { "service.name": '"platform-mcp-gateway"' },
            },
          },
        }
      : {}),
    gateways: { default: { port: MCP_GATEWAY_PORT } },
    routes: settings.servers.flatMap((server) => [
      ...(settings.formerOrigins ?? []).map((origin) => route(settings, server, origin)),
      route(settings, server, settings.origin),
    ]),
  };
}

export function renderAgentgatewayConfig(settings: McpGatewaySettings): string {
  const text = yaml.dump(agentgatewayConfig(settings), { lineWidth: -1, noRefs: true });
  if (text.includes("$")) {
    throw new Error("agentgateway env-expands its config file: a literal '$' would fail its load.");
  }
  return text;
}
