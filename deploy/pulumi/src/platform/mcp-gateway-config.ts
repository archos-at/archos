/**
 * The agentgateway configuration the platform MCP gateway runs (ADR-0154): a
 * pure function of the stack, so the specs can hold it against agentgateway's
 * own JSON schema without a cluster.
 *
 * agentgateway v1.7.0, standalone mode, the `gateways` + `routes` format of its
 * 1.7 docs. Read against tag `v1.7.0` (commit 26f5aebe, 2026-10-27).
 */
import * as yaml from "js-yaml";

/** Where the gateway listens inside the pod. Envoy Gateway terminates TLS in front of it. */
export const MCP_GATEWAY_PORT = 8080;
/** `/stats/prometheus` and `/metrics`. */
export const MCP_GATEWAY_STATS_PORT = 15020;
/** `/healthz/ready`. */
export const MCP_GATEWAY_READINESS_PORT = 15021;

/**
 * The platform MCP gateway (ADR-0154): agentgateway, standalone, behind Envoy
 * Gateway on its own host. Platform staff's agents sign in with WorkOS and
 * reach the MCP servers that run in the cluster; the servers themselves get no
 * listener, no DNS record and no certificate, and their credentials stay in the
 * cluster.
 *
 * Envoy terminates TLS and routes the host here, ungated: the gate is
 * agentgateway's, because only it answers the 401 with the protected-resource
 * metadata an MCP client needs to start its OAuth flow (RFC 9728). An Envoy
 * OIDC gate, the kind in front of Langfuse's UI, is a browser redirect no MCP
 * client follows.
 */
export const MCP_GATEWAY = {
  /** Deployment, Service, and `app.kubernetes.io/name`. */
  name: "platform-mcp-gateway",
  listenerName: "https-platform-mcp",
  tlsSecret: "platform-mcp-tls", // pragma: allowlist secret (Kubernetes Secret resource name, not a credential)
  routeName: "platform-mcp-gateway",
  configMap: "platform-mcp-gateway-config",
  sessionSecret: "platform-mcp-gateway-session", // pragma: allowlist secret (Kubernetes Secret resource name, not a credential)
  /**
   * agentgateway v1.7.0, the index digest the registry answered on 2026-11-05.
   * A literal pin, so `ci/pinned_images.py` hands it to trivy.
   */
  image: "cr.agentgateway.dev/agentgateway:v1.7.0@sha256:60216aafb03d37f94e952ff3d51d2f630a65b10ecaebdc0a864882f92610c45b",
  /** The image's `nonroot` user (Chainguard base). */
  uid: 65532,
} as const;

/**
 * WorkOS role slugs admitted, checked against the `roles` claim the
 * environment's JWT template adds (`docs/deployment/platform-mcp-gateway.md`).
 *
 * The owner role alone. `org-platform-support` is read-only in the console,
 * but a backend's credential is not: the Langfuse project key behind
 * `/langfuse/mcp` writes prompts, and nothing at this gateway can tell a write
 * tool from a read one by name alone. Widening this list is a decision about
 * what each backend's credential may do.
 */
export const ADMITTED_ROLES = ["org-platform-owner"] as const;

/** One MCP server inside the cluster, offered at `/<name>/mcp`. */
export interface McpServer {
  /**
   * The path segment and agentgateway's target name. Lowercase letters and
   * digits: agentgateway joins a target and a tool with `_`, so a name may not
   * contain one.
   */
  name: string;
  /** The server's streamable-HTTP endpoint, an in-cluster URL. */
  url: string;
  /**
   * The `Host` the server insists on, when it checks one. Set as a route
   * authority rewrite, which also turns off agentgateway's own rewrite to the
   * target's hostname.
   */
  authority?: string;
  /**
   * The credential the gateway presents, never the caller's token (which
   * agentgateway strips once it has validated it). Mounted from a Secret key
   * as a file the gateway watches, and written as the whole `Authorization`
   * header value.
   */
  credential?: { secretName: string; secretKey: string };
  /** The longest a call to this server may take. */
  timeout: string;
}

export interface McpGatewaySettings {
  /** `https://<public host>`, no trailing slash. Every resource URL hangs off it. */
  origin: string;
  /**
   * The gateway's former origins during a domain move, each served under its
   * own resource identifiers (RFC 9728 section 3.3) by a route bound to its
   * host. Empty outside a move.
   */
  formerOrigins?: readonly string[];
  /** The WorkOS AuthKit issuer, `https://<slug>.authkit.app`. */
  issuer: string;
  /** WorkOS id of the platform organization. */
  platformOrgId: string;
  servers: readonly McpServer[];
  /** `host:port` of the OTLP/HTTP collector, or undefined when none is deployed. */
  otlpHttpHost?: string;
}

/** Where a server's credential file is mounted in the container. */
export function credentialPath(server: McpServer): string {
  return `/var/run/secrets/mcp/${server.name}/authorization`;
}

/** The protected resource a server is (RFC 9728), and the audience its tokens must name (RFC 8707). */
export function resourceUrl(origin: string, server: McpServer): string {
  return `${origin}/${server.name}/mcp`;
}

/**
 * The gate, as a `require` rule: the platform organization, and an admitted
 * role in it. A missing claim makes the expression error, and agentgateway
 * counts an erroring `require` as unmet, so this fails closed.
 *
 * The discovery documents are exempt: a client reads them before it has a
 * token. agentgateway answers them ahead of this rule today; the guard keeps
 * discovery working if that order ever changes.
 */
export function admissionRule(platformOrgId: string): string {
  const roles = ADMITTED_ROLES.map((role) => `"${role}" in jwt.roles`).join(" || ");
  return `request.path.startsWith("/.well-known/") || (jwt.org_id == "${platformOrgId}" && (${roles}))`;
}

/**
 * One server's route as seen from `origin`. A route for a former origin is
 * bound to that host, and agentgateway picks an exact hostname before a route
 * with none, so the canonical route stays the catch-all it always was.
 * `audiences` holds every origin's identifier: a token issued for the former
 * host works on the new one and the reverse, as it does on the app's doors.
 */
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
      // agentgateway's own fallback for an MCP upstream is 10s to headers.
      http: { requestTimeout: server.timeout },
    },
  };
  return {
    name: former ? `${server.name}-${new URL(origin).hostname.replace(/\./g, "-")}` : server.name,
    ...(former ? { hostnames: [new URL(origin).hostname] } : {}),
    matches: [
      { path: { exact: path } },
      // The one discovery document a client fetches from us. It names
      // AuthKit, and the client reads AuthKit's own metadata from there.
      { path: { exact: `/.well-known/oauth-protected-resource${path}` } },
    ],
    policies: {
      mcpAuthentication: {
        // `strict` is the one mode that answers 401, which is what starts a
        // client's OAuth flow.
        mode: "strict",
        issuer: settings.issuer,
        audiences,
        jwks: { url: `${settings.issuer}/oauth2/jwks` },
        // Set explicitly: behind Envoy, the request's own scheme is http.
        resourceMetadata: {
          resource,
          scopesSupported: ["openid", "profile", "email", "offline_access"],
          bearerMethodsSupported: ["header"],
        },
      },
      authorization: { rules: [{ require: admissionRule(settings.platformOrgId) }] },
      ...(server.authority ? { urlRewrite: { authority: { full: server.authority } } } : {}),
    },
    backends: [{ mcp: { statefulMode: "stateful", targets: [target] } }],
  };
}

/** The config file, as an object. */
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
              // Sampling runs as a request arrives, before any token is read,
              // so on a public host it would trace every scanner and every
              // 401. Kept only for a request that passed validation: an
              // unset `jwt.sub` errors, and an erroring filter drops the span.
              filter: 'jwt.sub != ""',
              // CEL: a string literal is quoted.
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

/**
 * The config file, as YAML. agentgateway passes the whole file through shell
 * expansion on every load, comments included, and an undefined `$VAR` fails
 * the load, so a dollar sign anywhere is refused here rather than at runtime.
 */
export function renderAgentgatewayConfig(settings: McpGatewaySettings): string {
  const text = yaml.dump(agentgatewayConfig(settings), { lineWidth: -1, noRefs: true });
  if (text.includes("$")) {
    throw new Error("agentgateway env-expands its config file: a literal '$' would fail its load.");
  }
  return text;
}
