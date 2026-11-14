import { describe, it, expect, beforeAll } from "vitest";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "../test-support/stack-config";
import {
  AGENT_DOOR_PATHS,
  formerAgentOrigins,
  formerDomainListener,
  formerDomainRedirects,
  formerDomainRouteSpec,
  formerHostnames,
  formerMcpGatewayHost,
} from "./former-domain";
import { LEGACY_PROJECT, objectName } from "../names";

/**
 * The domain move's redirect (`app/former-domain.ts`, docs/deployment/domain-cutover.md).
 * Off by default; set, the former apex and app host answer 301 to their new twins.
 */

type Resource = { kind?: string; metadata: { name: string }; spec: Record<string, unknown> };
const ROUTES: Resource[] = [];
const POLICIES: Resource[] = [];
let gatewaySpec: { listeners: Array<{ name: string; hostname?: string; tls?: unknown }> } | undefined;

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      if (args.inputs.kind === "HTTPRoute") ROUTES.push(args.inputs as Resource);
      if (args.inputs.kind === "BackendTrafficPolicy") POLICIES.push(args.inputs as Resource);
      if (args.inputs.kind === "Gateway") gatewaySpec = args.inputs.spec;
      return { id: `${args.name}-id`, state: args.inputs };
    },
    call: () => ({}),
  },
  LEGACY_PROJECT,
  "test",
  false,
);

const hosts = { webDomain: "new.example.org", appDomain: "app.new.example.org" };

describe("formerDomainRedirects", () => {
  it("is off unless formerBaseDomain is set", () => {
    expect(formerDomainRedirects(hosts)).toEqual([]);
    expect(formerDomainRedirects({ ...hosts, formerBaseDomain: "  " })).toEqual([]);
  });

  it("moves the apex and the app host, nothing else", () => {
    const redirects = formerDomainRedirects({ ...hosts, formerBaseDomain: "old.example.org" });
    expect(redirects.map((r) => [r.from, r.to])).toEqual([
      ["old.example.org", "new.example.org"],
      ["app.old.example.org", "app.new.example.org"],
    ]);
  });

  it("refuses to redirect the domain the stack still serves", () => {
    expect(() => formerDomainRedirects({ ...hosts, formerBaseDomain: "new.example.org" })).toThrow(/formerBaseDomain/);
  });

  it("answers 301 with only the host changed, so path and query carry over", () => {
    const [web] = formerDomainRedirects({ ...hosts, formerBaseDomain: "old.example.org" });
    expect(formerDomainRouteSpec(web, "edge")).toEqual({
      parentRefs: [{ name: "edge", sectionName: "https-former-web" }],
      hostnames: ["old.example.org"],
      rules: [{ filters: [{ type: "RequestRedirect", requestRedirect: { hostname: "new.example.org", statusCode: 301 } }] }],
    });
    expect(formerDomainListener(web)).toMatchObject({ port: 443, protocol: "HTTPS", hostname: "old.example.org" });
  });
});

describe("agents on the former host", () => {
  const moving = { ...hosts, formerBaseDomain: "old.example.org" };

  it("serves the agent doors and their discovery documents on the former app host, and 301s the rest", () => {
    const [, app] = formerDomainRedirects(moving);
    expect(formerDomainRouteSpec(app, "edge").rules).toEqual([
      {
        matches: AGENT_DOOR_PATHS.map((value) => ({ path: { type: "PathPrefix", value } })),
        backendRefs: [{ name: "frontend", port: 3000 }],
      },
      { filters: [{ type: "RequestRedirect", requestRedirect: { hostname: "app.new.example.org", statusCode: 301 } }] },
    ]);
    expect(AGENT_DOOR_PATHS).toEqual([
      "/api/mcp",
      "/api/a2a",
      "/api/platform/mcp",
      "/.well-known/oauth-protected-resource",
    ]);
  });

  it("tells the frontend the former app origin, and nothing outside a move", () => {
    expect(formerAgentOrigins(moving)).toEqual(["https://app.old.example.org"]);
    expect(formerAgentOrigins(hosts)).toEqual([]);
  });

  it("keeps the platform MCP gateway's former twin while the gateway runs", () => {
    const gateway = { enabled: true, domain: "platform-mcp.new.example.org" };
    expect(formerMcpGatewayHost(moving, gateway)).toEqual({
      from: "platform-mcp.old.example.org",
      listener: "https-former-platform-mcp",
      tlsSecret: objectName("formerPlatformMcpTls"),
    });
    expect(formerMcpGatewayHost(moving, { ...gateway, enabled: false })).toBeUndefined();
    expect(formerMcpGatewayHost(hosts, gateway)).toBeUndefined();
    // An overridden host off the stack's apex has no derivable twin.
    expect(formerMcpGatewayHost(moving, { enabled: true, domain: "mcp.elsewhere.org" })).toBeUndefined();
    expect(formerHostnames(moving, gateway)).toEqual([
      "old.example.org",
      "app.old.example.org",
      "platform-mcp.old.example.org",
    ]);
  });
});

describe("a stack with formerBaseDomain set", () => {
  beforeAll(async () => {
    pulumi.runtime.setAllConfig({
      ...baseStackConfig(),
      [`${LEGACY_PROJECT}:observabilityEnabled`]: "false",
      [`${LEGACY_PROJECT}:formerBaseDomain`]: "old.example.org",
    });
    const { loadConfig } = await import("../config");
    const { installHttpRoutes } = await import("./httproutes");
    const { installGatewayResources } = await import("../platform/gateway");
    const provider = new k8s.Provider("test", { kubeconfig: "apiVersion: v1" });
    const cfg = loadConfig();
    const routes = installHttpRoutes(cfg, provider, objectName("namespace"), []);
    const { gateway } = installGatewayResources(cfg, provider, objectName("namespace"), "issuer", []);
    await Promise.all([...Object.values(routes), gateway].map((r) => new Promise((resolve) => r.id.apply(resolve))));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it("gives the Gateway a TLS listener per former host", () => {
    const former = gatewaySpec?.listeners.filter((l) => l.name.startsWith("https-former-"));
    expect(former?.map((l) => l.hostname)).toEqual(["old.example.org", "app.old.example.org"]);
    expect(former?.every((l) => l.tls)).toBe(true);
  });

  it("creates the two redirect routes", () => {
    const redirects = ROUTES.filter((r) => r.metadata.name.includes("former"));
    expect(redirects.map((r) => r.metadata.name).sort()).toEqual([objectName("formerAppRedirectRoute"), objectName("formerWebRedirectRoute")].sort());
  });

  it("gives the former app route the app route's timeout, retry and per-client budget", () => {
    const policy = POLICIES.find((p) => p.metadata.name === objectName("formerAppTimeouts"));
    expect(policy?.spec).toMatchObject({
      targetRefs: [{ group: "gateway.networking.k8s.io", kind: "HTTPRoute", name: objectName("formerAppRedirectRoute") }],
      timeout: { http: { requestTimeout: "3600s" } },
    });
    expect(policy?.spec.retry).toBeDefined();
  });
});
