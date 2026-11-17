import { createHmac } from "node:crypto";
import * as pulumi from "@pulumi/pulumi";
import { bool } from "./readers";

export interface McpGatewayConfig {
  enabled: boolean;
  domain: string;
  issuer: string;
  platformOrgId: string;
  sessionKey: pulumi.Output<string>;
  admissionToken: pulumi.Output<string>;
}

const ORG_ID = /^org_[0-9A-Za-z]+$/;
const SESSION_KEY = /^[0-9a-f]{64}$/;
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?(\.[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?)+$/;

export function loadMcpGateway(
  cfg: pulumi.Config,
  baseDomain: string,
  authkitDomain: string,
  hasServer: boolean,
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
  if (!ORG_ID.test(platformOrgId)) {
    throw new Error(`${project}:mcpGatewayPlatformOrgId must be a WorkOS organization id (org_…), got "${platformOrgId}".`);
  }
  if (!HOSTNAME.test(domain)) {
    throw new Error(`${project}:mcpGatewayDomain must be a bare lowercase hostname such as platform-mcp.example.test, got "${domain}".`);
  }
  if (!hasServer) {
    throw new Error(`${project}:mcpGatewayEnabled has no MCP server to serve: Langfuse is off on this stack, and so is the CMS.`);
  }
  return {
    enabled: true,
    domain,
    issuer: `https://${authkitDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`,
    platformOrgId,
    sessionKey: sessionKey!.apply(checkSessionKey),
    admissionToken,
  };
}

export function checkSessionKey(raw: string): string {
  const key = raw.trim();
  if (!SESSION_KEY.test(key)) {
    throw new Error(`${pulumi.getProject()}:mcpGatewaySessionKey must be 64 lowercase hex characters: openssl rand -hex 32`);
  }
  return key;
}
