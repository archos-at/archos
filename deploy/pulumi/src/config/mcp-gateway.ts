/**
 * The platform MCP gateway (ADR-0154): one public host where platform staff's
 * agents reach the MCP servers that run inside the cluster, behind WorkOS.
 */
import { createHmac } from "node:crypto";
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
   * 32 bytes as 64 hex characters. agentgateway encrypts its MCP session ids
   * with it, and every replica needs the same key to serve every session.
   * `mcpGatewaySessionKey`, or a one-way HMAC of `pgAppPassword` under its own
   * label (like the CMS's credentials), so turning the gateway on needs no new
   * secret. Rotating it ends the sessions in flight (clients reconnect).
   */
  sessionKey: pulumi.Output<string>;
  /**
   * The secret the gateway presents to the app's admission route
   * (`/api/internal/platform-mcp-admission`), which admits a person whose token
   * names another organization from their live platform membership (ADR-0154,
   * amendment of 2026-11-05). A one-way HMAC of `pgAppPassword` under its own
   * label, so it needs no new secret and opens that one route alone.
   */
  admissionToken: pulumi.Output<string>;
}

const ORG_ID = /^org_[0-9A-Za-z]+$/;
const SESSION_KEY = /^[0-9a-f]{64}$/;
/** A bare lowercase DNS name: it becomes a listener hostname, a route hostname and an `https://` origin. */
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?(\.[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?)+$/;

/**
 * Off unless asked for, and once asked for, every dependency is required: a
 * gateway planned without its issuer or its organization would publish a host
 * that admits nobody, or, worse, a rule that names nothing.
 */
export function loadMcpGateway(
  cfg: pulumi.Config,
  baseDomain: string,
  authkitDomain: string,
  /** Whether any in-cluster MCP server runs on this stack: Langfuse or the CMS. */
  hasServer: boolean,
  /** `pgAppPassword`, the root the session key is derived from when `mcpGatewaySessionKey` is unset. */
  appPassword?: pulumi.Output<string>,
): McpGatewayConfig {
  const project = pulumi.getProject();
  const enabled = bool(cfg, "mcpGatewayEnabled", false);
  const domain = cfg.get("mcpGatewayDomain") ?? `platform-mcp.${baseDomain}`;
  const platformOrgId = (cfg.get("mcpGatewayPlatformOrgId") ?? "").trim();
  const sessionKey =
    cfg.getSecret("mcpGatewaySessionKey") ??
    appPassword?.apply((password) => createHmac("sha256", password).update("platform-mcp-gateway-session").digest("hex"));
  const admissionToken =
    appPassword?.apply((password) => createHmac("sha256", password).update("platform-mcp-admission").digest("hex")) ??
    pulumi.output("");
  const off = { enabled: false, domain, issuer: "", platformOrgId, sessionKey: pulumi.output(""), admissionToken };
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
  if (!HOSTNAME.test(domain)) {
    throw new Error(`${project}:mcpGatewayDomain must be a bare lowercase hostname such as platform-mcp.example.test, got "${domain}".`);
  }
  // Langfuse and the CMS are the in-cluster MCP servers. A gateway with nothing
  // behind it is a public host that answers 404 to everyone.
  if (!hasServer) {
    throw new Error(`${project}:mcpGatewayEnabled has no MCP server to serve: Langfuse is off on this stack, and so is the CMS.`);
  }
  return {
    enabled: true,
    domain,
    issuer: `https://${authkitDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`,
    platformOrgId,
    // Checked where the value resolves, so the plan never reads the secret
    // in the clear; a malformed key fails the preview all the same.
    sessionKey: sessionKey!.apply(checkSessionKey),
    admissionToken,
  };
}

/** The session key as agentgateway takes it: 64 lowercase hex characters, or the plan fails. */
export function checkSessionKey(raw: string): string {
  const key = raw.trim();
  if (!SESSION_KEY.test(key)) {
    throw new Error(`${pulumi.getProject()}:mcpGatewaySessionKey must be 64 lowercase hex characters: openssl rand -hex 32`);
  }
  return key;
}
