/**
 * The platform MCP gateway (ADR-0154): one public host where platform staff's
 * agents reach the MCP servers that run inside the cluster, behind WorkOS.
 */
import * as pulumi from "@pulumi/pulumi";
import { bool } from "./readers";

export interface McpGatewayConfig {
  /**
   * `mcpGatewayEnabled`, off by default like every other agent door. Off, no
   * listener, certificate, DNS record, route, Deployment or NetworkPolicy
   * exists for it.
   */
  enabled: boolean;
  /** Public hostname. Derived: `platform-mcp.<baseDomain>` unless `mcpGatewayDomain` overrides it. */
  domain: string;
  /**
   * The WorkOS authorization server, `https://<workosAuthkitDomain>`: the same
   * AuthKit the office doors take their tokens from.
   */
  issuer: string;
  /**
   * WorkOS id (`org_…`) of the platform organization. A token whose `org_id`
   * is anything else is refused at the gateway. Not `platformOrgExternalId`:
   * the token carries the WorkOS id, never the external one.
   */
  platformOrgId: string;
  /**
   * 32 random bytes as 64 hex characters. agentgateway encrypts its MCP session
   * ids with it, and every replica needs the same key to serve every session.
   * Rotating it ends the sessions in flight (clients reconnect).
   */
  sessionKey: pulumi.Output<string>;
}

const ORG_ID = /^org_[0-9A-Za-z]+$/;
const SESSION_KEY = /^[0-9a-f]{64}$/;

/**
 * Off unless asked for, and once asked for, every dependency is required: a
 * gateway planned without its issuer or its organization would publish a host
 * that admits nobody, or, worse, a rule that names nothing.
 */
export function loadMcpGateway(
  cfg: pulumi.Config,
  baseDomain: string,
  authkitDomain: string,
  langfuseEnabled: boolean,
): McpGatewayConfig {
  const project = pulumi.getProject();
  const enabled = bool(cfg, "mcpGatewayEnabled", false);
  const domain = cfg.get("mcpGatewayDomain") ?? `platform-mcp.${baseDomain}`;
  const platformOrgId = (cfg.get("mcpGatewayPlatformOrgId") ?? "").trim();
  const sessionKey = cfg.getSecret("mcpGatewaySessionKey");
  const off = { enabled: false, domain, issuer: "", platformOrgId, sessionKey: pulumi.output("") };
  if (!enabled) return off;

  const missing = [
    authkitDomain === "" ? "workosAuthkitDomain" : undefined,
    platformOrgId === "" ? "mcpGatewayPlatformOrgId" : undefined,
    sessionKey === undefined ? "mcpGatewaySessionKey" : undefined,
  ].filter((k): k is string => k !== undefined);
  if (missing.length > 0) {
    throw new Error(
      `${project}:mcpGatewayEnabled needs ${missing.map((k) => `${project}:${k}`).join(", ")} ` +
        "(docs/deployment/platform-mcp-gateway.md).",
    );
  }
  // Interpolated into a CEL rule and into a file agentgateway env-expands, so
  // anything but the WorkOS id shape is refused rather than escaped.
  if (!ORG_ID.test(platformOrgId)) {
    throw new Error(`${project}:mcpGatewayPlatformOrgId must be a WorkOS organization id (org_…), got "${platformOrgId}".`);
  }
  if (!SESSION_KEY.test((cfg.get("mcpGatewaySessionKey") ?? "").trim())) {
    throw new Error(`${project}:mcpGatewaySessionKey must be 64 lowercase hex characters: openssl rand -hex 32`);
  }
  // Langfuse is the one in-cluster MCP server today. A gateway with nothing
  // behind it is a public host that answers 404 to everyone.
  if (!langfuseEnabled) {
    throw new Error(`${project}:mcpGatewayEnabled has no MCP server to serve: Langfuse is off on this stack.`);
  }
  return {
    enabled: true,
    domain,
    issuer: `https://${authkitDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`,
    platformOrgId,
    sessionKey: sessionKey!.apply((key) => key.trim()),
  };
}
