import type { IGatewaySpec } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1/GatewaySpec";
import type { IHTTPRouteSpec } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1/HTTPRouteSpec";
import { PORT } from "../constants";
import { objectName, type NameKey } from "../names";

export interface FormerDomainRedirect {
  from: string;
  to: string;
  listener: string;
  tlsSecret: string;
  route: string;
  serves: readonly string[];
}

export const AGENT_DOOR_PATHS = [
  "/api/mcp",
  "/api/a2a",
  "/api/platform/mcp",
  "/.well-known/oauth-protected-resource",
] as const;

function formerTwin(host: string, ingress: { formerBaseDomain?: string; webDomain: string }): string | undefined {
  const former = ingress.formerBaseDomain?.trim();
  if (!former || !host.endsWith(`.${ingress.webDomain}`)) return undefined;
  return `${host.slice(0, -ingress.webDomain.length)}${former}`;
}

const HOSTS: Array<{ part: "web" | "app"; tls: NameKey; route: NameKey }> = [
  { part: "web", tls: "formerWebTls", route: "formerWebRedirectRoute" },
  { part: "app", tls: "formerAppTls", route: "formerAppRedirectRoute" },
];

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

export interface FormerServedHost {
  from: string;
  listener: string;
  tlsSecret: string;
}

export function formerMcpGatewayHost(
  ingress: { formerBaseDomain?: string; webDomain: string },
  mcpGateway: { enabled: boolean; domain: string },
): FormerServedHost | undefined {
  if (!mcpGateway.enabled) return undefined;
  const from = formerTwin(mcpGateway.domain, ingress);
  if (!from) return undefined;
  return { from, listener: "https-former-platform-mcp", tlsSecret: objectName("formerPlatformMcpTls") };
}

export function formerAgentOrigins(ingress: { formerBaseDomain?: string; webDomain: string; appDomain: string }): string[] {
  return formerDomainRedirects(ingress)
    .filter((redirect) => redirect.serves.length > 0)
    .map((redirect) => `https://${redirect.from}`);
}

export function formerAgentOriginsEnv(ingress: {
  formerBaseDomain?: string;
  webDomain: string;
  appDomain: string;
}): Array<{ name: string; value: string }> {
  const origins = formerAgentOrigins(ingress);
  return origins.length > 0 ? [{ name: "MCP_FORMER_ORIGINS", value: origins.join(",") }] : [];
}

export function formerHostnames(
  ingress: { formerBaseDomain?: string; webDomain: string; appDomain: string },
  mcpGateway: { enabled: boolean; domain: string },
): string[] {
  const gateway = formerMcpGatewayHost(ingress, mcpGateway);
  return [...formerDomainRedirects(ingress).map((r) => r.from), ...(gateway ? [gateway.from] : [])];
}

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
