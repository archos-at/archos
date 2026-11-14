import type { IGatewaySpec } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1/GatewaySpec";
import type { IHTTPRouteSpec } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1/HTTPRouteSpec";
import { PORT } from "../constants";
import { objectName, type NameKey } from "../names";

/**
 * The domain move's redirect (docs/deployment/domain-cutover.md): while the
 * stack serves a new `baseDomain`, the hosts of the former one answer with a
 * permanent redirect to their new twin, path and query kept.
 *
 * OFF unless `formerBaseDomain` is set. Only the two hosts people and search
 * engines hold links to move this way: the website's apex and the app. The
 * S3 host signs short-lived URLs, and the operator hosts (otel., langfuse.,
 * qdrant.) are re-registered rather than redirected.
 *
 * Agents are the exception to the redirect. An MCP or A2A client holds the URL
 * it was set up with, does not carry a POST across a 301, and binds its token
 * to that URL (RFC 8707, RFC 9728 section 3.3), so the former app host keeps
 * SERVING the agent doors and their discovery documents (`AGENT_DOOR_PATHS`)
 * from the same pods, and the platform MCP gateway keeps its former host
 * (`formerMcpGatewayHost`). The app and the gateway accept both hosts' token
 * audiences and name the host the client used in their metadata.
 *
 * The Gateway needs a listener and a certificate per former host
 * (cert-manager issues it over HTTP-01 like any other), so the former hosts'
 * DNS records must keep pointing at the gateway: see the runbook's
 * "DNS of the former domain" before the zone moves.
 */
export interface FormerDomainRedirect {
  /** The former host, e.g. `old.example.org`. */
  from: string;
  /** The host it now lives at, e.g. `new.example.org`. */
  to: string;
  /** The Gateway listener (section) that terminates TLS for `from`. */
  listener: string;
  /** The Secret cert-manager writes the certificate for `from` into. */
  tlsSecret: string;
  /** The HTTPRoute's object name. */
  route: string;
  /** Paths the former host still serves from the stack instead of redirecting: the app's agent doors. */
  serves: readonly string[];
}

/**
 * What the app's former host serves instead of redirecting, as Gateway API
 * PathPrefix values (whole path segments): the three agent doors and their
 * RFC 9728 documents. The agent card is a GET, which clients follow across the
 * 301, so it moves like any page.
 */
export const AGENT_DOOR_PATHS = [
  "/api/mcp",
  "/api/a2a",
  "/api/platform/mcp",
  "/.well-known/oauth-protected-resource",
] as const;

/** `host`'s twin under the former domain, when `host` hangs off the apex the stack serves; else undefined. */
function formerTwin(host: string, ingress: { formerBaseDomain?: string; webDomain: string }): string | undefined {
  const former = ingress.formerBaseDomain?.trim();
  if (!former || !host.endsWith(`.${ingress.webDomain}`)) return undefined;
  return `${host.slice(0, -ingress.webDomain.length)}${former}`;
}

const HOSTS: Array<{ part: "web" | "app"; tls: NameKey; route: NameKey }> = [
  { part: "web", tls: "formerWebTls", route: "formerWebRedirectRoute" },
  { part: "app", tls: "formerAppTls", route: "formerAppRedirectRoute" },
];

/**
 * The redirects for `formerBaseDomain`, or none when it is unset. Throws when it
 * names a host the stack still serves, which would make the stack redirect to itself.
 */
export function formerDomainRedirects(ingress: {
  formerBaseDomain?: string;
  webDomain: string;
  appDomain: string;
}): FormerDomainRedirect[] {
  const former = ingress.formerBaseDomain?.trim();
  if (!former) return [];
  if (former === ingress.webDomain || `app.${former}` === ingress.appDomain) {
    throw new Error(`formerBaseDomain (${former}) is the domain this stack serves; set it to the domain being left`);
  }
  return HOSTS.map(({ part, tls, route }) => ({
    from: part === "web" ? former : `app.${former}`,
    to: part === "web" ? ingress.webDomain : ingress.appDomain,
    listener: `https-former-${part}`,
    tlsSecret: objectName(tls),
    route: objectName(route),
    serves: part === "app" ? AGENT_DOOR_PATHS : [],
  }));
}

/** A former host that is served, not redirected: the platform MCP gateway's. */
export interface FormerServedHost {
  from: string;
  listener: string;
  tlsSecret: string;
}

/**
 * The platform MCP gateway's former host (`platform-mcp.<formerBaseDomain>`)
 * while the gateway runs and a move is in progress; undefined otherwise, or
 * when `mcpGatewayDomain` is overridden to a host off the stack's apex.
 */
export function formerMcpGatewayHost(
  ingress: { formerBaseDomain?: string; webDomain: string },
  mcpGateway: { enabled: boolean; domain: string },
): FormerServedHost | undefined {
  if (!mcpGateway.enabled) return undefined;
  const from = formerTwin(mcpGateway.domain, ingress);
  if (!from) return undefined;
  return { from, listener: "https-former-platform-mcp", tlsSecret: objectName("formerPlatformMcpTls") };
}

/** The app's former origins the agent doors still answer at, for the frontend's `MCP_FORMER_ORIGINS`. */
export function formerAgentOrigins(ingress: { formerBaseDomain?: string; webDomain: string; appDomain: string }): string[] {
  return formerDomainRedirects(ingress)
    .filter((redirect) => redirect.serves.length > 0)
    .map((redirect) => `https://${redirect.from}`);
}

/**
 * `MCP_FORMER_ORIGINS` for the frontend during a move: the doors then accept
 * and advertise the former host's resource identifiers too. None otherwise.
 */
export function formerAgentOriginsEnv(ingress: {
  formerBaseDomain?: string;
  webDomain: string;
  appDomain: string;
}): Array<{ name: string; value: string }> {
  const origins = formerAgentOrigins(ingress);
  return origins.length > 0 ? [{ name: "MCP_FORMER_ORIGINS", value: origins.join(",") }] : [];
}

/** Every former host that needs a listener, a certificate and an A record. */
export function formerHostnames(
  ingress: { formerBaseDomain?: string; webDomain: string; appDomain: string },
  mcpGateway: { enabled: boolean; domain: string },
): string[] {
  const gateway = formerMcpGatewayHost(ingress, mcpGateway);
  return [...formerDomainRedirects(ingress).map((r) => r.from), ...(gateway ? [gateway.from] : [])];
}

/** The HTTPS listener that terminates TLS for one former host. */
export function formerDomainListener(redirect: FormerServedHost): IGatewaySpec["listeners"][number] {
  return {
    name: redirect.listener,
    port: 443,
    protocol: "HTTPS",
    hostname: redirect.from,
    tls: { mode: "Terminate", certificateRefs: [{ name: redirect.tlsSecret }] },
    allowedRoutes: { namespaces: { from: "Same" } },
  };
}

/**
 * Every request to the former host: 301 to the same path on the new host. A
 * RequestRedirect with only `hostname` keeps scheme, path and query (Gateway
 * API, HTTPRequestRedirectFilter). 301 because the move is permanent and the
 * search engines' Change of Address expects it.
 *
 * Except the paths in `serves`, which go to the frontend as on the new host:
 * a rule with a PathPrefix match outranks the redirect's match-everything
 * rule (Gateway API: the longest path match wins).
 */
export function formerDomainRouteSpec(redirect: FormerDomainRedirect, gatewayName: string): IHTTPRouteSpec {
  const served =
    redirect.serves.length > 0
      ? [
          {
            matches: redirect.serves.map((value) => ({ path: { type: "PathPrefix" as const, value } })),
            backendRefs: [{ name: "frontend", port: PORT.frontend }],
          },
        ]
      : [];
  return {
    parentRefs: [{ name: gatewayName, sectionName: redirect.listener }],
    hostnames: [redirect.from],
    rules: [
      ...served,
      { filters: [{ type: "RequestRedirect", requestRedirect: { hostname: redirect.to, statusCode: 301 } }] },
    ],
  };
}
