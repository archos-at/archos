import { describe, it, expect, beforeAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import Ajv2020 from "ajv/dist/2020";
import * as yaml from "js-yaml";
import schema from "./src/test-support/agentgateway-config.v1.7.0.schema.json";
import { baseStackConfig, langfuseStackConfig } from "./src/test-support/stack-config";
import { loadMcpGateway } from "./src/config/mcp-gateway";
import { GATEWAY_NAME } from "./src/platform/gateway";
import { LEGACY_PROJECT } from "./src/names";

/** A stack config key of the project these specs run as. */
const key = (name: string): string => `${LEGACY_PROJECT}:${name}`;

/**
 * The platform MCP gateway (ADR-0154), the whole program built with it on and
 * with it off.
 *
 * What fails here plans clean and breaks only on a cluster or at a client: a
 * config file agentgateway refuses to load (held against its own v1.7.0
 * schema, vendored), a token for another audience or organization let
 * through, the caller's token or the whole Langfuse Secret handed to the pod,
 * a NetworkPolicy that times out every call behind a green deploy, a host in
 * DNS with no listener.
 */

const DOMAIN = "dev.example.test";
const HOST = `platform-mcp.${DOMAIN}`;
const ORG = "org_01HPLATFORMTEST";
const SESSION_KEY = "a".repeat(64); // pragma: allowlist secret

type Resource = { type: string; name: string; inputs: Record<string, unknown> };
type Listener = { name: string; protocol: string; hostname?: string };
type Route = { spec: { parentRefs: unknown[]; hostnames: string[]; rules: unknown[] } };
type Policy = { spec: { targetRefs: Array<{ name: string }> } };
type NetworkPolicy = { spec: unknown };
type ConfigMap = { data: Record<string, string> };
type Container = {
  image: string;
  env: unknown[];
  securityContext: Record<string, unknown>;
  readinessProbe: { httpGet: unknown };
  volumeMounts: unknown[];
};
type Deployment = { spec: { replicas: number; template: { spec: { containers: Container[]; volumes: unknown[] } } } };
type AgTarget = { mcp: unknown; policies: { backendAuth?: unknown } };
type AgRoute = {
  name: string;
  matches: unknown[];
  policies: { mcpAuthentication: unknown; authorization: unknown; urlRewrite?: unknown };
  backends: Array<{ mcp: { targets: AgTarget[] } }>;
};
type AgConfig = { routes: AgRoute[]; frontendPolicies: { tracing: unknown } };
const RESOURCES: Resource[] = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}-id`, state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } } };
    },
    call: () => ({}),
  },
  LEGACY_PROJECT,
  "test",
  false,
);

const TYPE = {
  route: "kubernetes:gateway.networking.k8s.io/v1:HTTPRoute",
  policy: "kubernetes:gateway.envoyproxy.io/v1alpha1:SecurityPolicy",
  networkPolicy: "kubernetes:networking.k8s.io/v1:NetworkPolicy",
  deployment: "kubernetes:apps/v1:Deployment",
  configMap: "kubernetes:core/v1:ConfigMap",
  dns: "cloudflare:index/dnsRecord:DnsRecord",
} as const;

function onStack(): Record<string, string> {
  return {
    ...baseStackConfig(),
    ...langfuseStackConfig(),
    [key("baseDomain")]: DOMAIN,
    [key("workosAuthkitDomain")]: "tenant.authkit.app",
    [key("mcpGatewayEnabled")]: "true",
    [key("mcpGatewayPlatformOrgId")]: ORG,
    [key("mcpGatewaySessionKey")]: SESSION_KEY,
    [key("loadBalancerIp")]: "203.0.113.10",
    [key("dnsEnabled")]: "true",
    [key("dnsZoneId")]: "zone-abc123",
    [key("dnsZoneName")]: "example.test",
    [key("cloudflareApiToken")]: "cf-token", // pragma: allowlist secret
  };
}

async function build(values: Record<string, string>): Promise<void> {
  vi.resetModules();
  RESOURCES.length = 0;
  pulumi.runtime.setAllConfig(values);
  const stack = (await import("./index")) as Record<string, unknown>;
  await Promise.all(
    Object.values(stack)
      .filter((v): v is pulumi.Output<unknown> => pulumi.Output.isInstance(v))
      .map((output) => new Promise((resolve) => output.apply(resolve))),
  );
}

function find<T>(type: string, name: string): T {
  const hit = RESOURCES.find((r) => r.type === type && r.name === name);
  expect(hit, `${type} ${name}`).toBeDefined();
  return hit!.inputs as unknown as T;
}
const listeners = (): Listener[] =>
  (RESOURCES.find((r) => r.name === GATEWAY_NAME)!.inputs.spec as { listeners: Listener[] }).listeners;
const configText = (): string => find<ConfigMap>(TYPE.configMap, "platform-mcp-gateway-config").data["config.yaml"];
const config = (): AgConfig => yaml.load(configText()) as AgConfig;
const langfuseRoute = (): AgRoute => config().routes.find((r) => r.name === "langfuse")!;
const pod = () => find<Deployment>(TYPE.deployment, "platform-mcp-gateway").spec.template.spec;

describe("the platform MCP gateway, switched on", () => {
  beforeAll(() => build(onStack()), 120_000);

  it("adds an https-platform-mcp listener whose certificate cert-manager issues", () => {
    expect(listeners().find((l) => l.name === "https-platform-mcp")).toEqual({
      name: "https-platform-mcp",
      port: 443,
      protocol: "HTTPS",
      hostname: HOST,
      tls: { mode: "Terminate", certificateRefs: [{ name: "platform-mcp-tls" }] },
      allowedRoutes: { namespaces: { from: "Same" } },
    });
  });

  it("publishes the host to DNS, so every HTTPS listener still has exactly one record", () => {
    const records = RESOURCES.filter((r) => r.type === TYPE.dns).map((r) => r.inputs.name as string);
    const hosts = listeners()
      .filter((l) => l.protocol === "HTTPS" && l.hostname !== undefined)
      .map((l) => l.hostname as string);
    expect(records).toContain(HOST);
    expect([...records].sort()).toEqual([...hosts].sort());
  });

  it("routes the whole host to the gateway Service, with no Envoy gate in front", () => {
    // An Envoy OIDC gate answers with a browser redirect, and an MCP client
    // needs agentgateway's 401 + resource metadata to start its OAuth flow.
    const spec = find<Route>(TYPE.route, "platform-mcp-gateway-route").spec;
    expect(spec.parentRefs).toEqual([{ name: GATEWAY_NAME, sectionName: "https-platform-mcp" }]);
    expect(spec.hostnames).toEqual([HOST]);
    expect(spec.rules).toEqual([
      { backendRefs: [{ name: "platform-mcp-gateway", port: 8080 }], timeouts: { request: "3600s", backendRequest: "3600s" } },
    ]);
    const gates = RESOURCES.filter((r) => r.type === TYPE.policy).flatMap(
      (r) => (r.inputs as unknown as Policy).spec.targetRefs,
    );
    expect(gates.map((t) => t.name)).not.toContain("platform-mcp-gateway");
  });

  it("writes a config agentgateway v1.7.0's own schema accepts", () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const valid = ajv.validate(schema, config());
    expect(ajv.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
    // The schema is strict about keys, so a typo would have failed above.
    expect(ajv.validate(schema, { ...config(), rouets: [] })).toBe(false);
  });

  it("writes no dollar sign, which agentgateway would env-expand and fail on", () => {
    expect(configText()).not.toContain("$");
  });

  it("is the protected resource /langfuse/mcp, with tokens bound to it alone", () => {
    const auth = langfuseRoute().policies.mcpAuthentication;
    const resource = `https://${HOST}/langfuse/mcp`;
    expect(auth).toEqual({
      mode: "strict",
      issuer: "https://tenant.authkit.app",
      audiences: [resource],
      jwks: { url: "https://tenant.authkit.app/oauth2/jwks" },
      resourceMetadata: {
        resource,
        scopesSupported: ["openid", "profile", "email", "offline_access"],
        bearerMethodsSupported: ["header"],
      },
    });
    expect(langfuseRoute().matches).toEqual([
      { path: { exact: "/langfuse/mcp" } },
      { path: { exact: "/.well-known/oauth-protected-resource/langfuse/mcp" } },
      { path: { exact: "/.well-known/oauth-authorization-server/langfuse/mcp" } },
    ]);
  });

  it("admits the platform organization's owner role, and nothing else", () => {
    expect(langfuseRoute().policies.authorization).toEqual({
      rules: [
        {
          require: `request.path.startsWith("/.well-known/") || (jwt.org_id == "${ORG}" && ("org-platform-owner" in jwt.roles))`,
        },
      ],
    });
  });

  it("calls Langfuse in-cluster under its public Host, with the project key from a file", () => {
    const route = langfuseRoute();
    expect(route.policies.urlRewrite).toEqual({ authority: { full: `langfuse.${DOMAIN}` } });
    const [target] = route.backends[0].mcp.targets;
    expect(target.mcp).toEqual({ host: "http://langfuse-web:3000/api/public/mcp" });
    expect(target.policies.backendAuth).toEqual({
      key: {
        value: { file: "/var/run/secrets/mcp/langfuse/authorization" },
        // The Secret key already holds `Basic …`.
        location: { header: { name: "authorization", prefix: "" } },
      },
    });
  });

  it("traces to the collector as its own service", () => {
    expect(config().frontendPolicies.tracing).toMatchObject({
      host: "otel-collector:4318",
      protocol: "http",
      resources: { "service.name": '"platform-mcp-gateway"' },
    });
  });

  it("runs the pinned image, two replicas, with the shared session key from its Secret", () => {
    const deployment = find<Deployment>(TYPE.deployment, "platform-mcp-gateway");
    expect(deployment.spec.replicas).toBe(2);
    const [container] = pod().containers;
    expect(container.image).toMatch(/^cr\.agentgateway\.dev\/agentgateway:v1\.7\.0@sha256:[a-f0-9]{64}$/);
    expect(container.env).toEqual([
      {
        name: "SESSION_KEY",
        valueFrom: { secretKeyRef: { name: "platform-mcp-gateway-session", key: "session-key" } },
      },
    ]);
    expect(container.securityContext).toMatchObject({ readOnlyRootFilesystem: true, allowPrivilegeEscalation: false });
    expect(container.readinessProbe.httpGet).toEqual({ path: "/healthz/ready", port: 15021 });
  });

  it("mounts the one Langfuse key it presents, never the rest of that Secret", () => {
    expect(pod().volumes).toContainEqual({
      name: "credential-langfuse",
      secret: { secretName: "langfuse-secrets", items: [{ key: "otlp-basic-auth", path: "authorization" }] },
    });
    expect(pod().containers[0].volumeMounts).toContainEqual({
      name: "credential-langfuse",
      mountPath: "/var/run/secrets/mcp/langfuse",
      readOnly: true,
    });
  });

  it("lets the edge reach the gateway's listener, and the gateway reach Langfuse's web port", () => {
    expect(find<NetworkPolicy>(TYPE.networkPolicy, "allow-edge-to-platform-mcp-gateway").spec).toEqual({
      podSelector: { matchLabels: { "app.kubernetes.io/name": "platform-mcp-gateway" } },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "envoy-gateway-system" } } }],
          ports: [{ protocol: "TCP", port: 8080 }],
        },
      ],
    });
    expect(find<NetworkPolicy>(TYPE.networkPolicy, "allow-platform-mcp-gateway-to-langfuse").spec).toEqual({
      podSelector: { matchLabels: { "app.kubernetes.io/name": "langfuse-web" } },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "platform-mcp-gateway" } } }],
          ports: [{ protocol: "TCP", port: 3000 }],
        },
      ],
    });
  });
});

describe("the platform MCP gateway, by default", () => {
  beforeAll(() => {
    const { [key("mcpGatewayEnabled")]: _, ...rest } = onStack();
    return build(rest);
  }, 120_000);

  it("creates nothing: no listener, record, route, pod or NetworkPolicy", () => {
    expect(listeners().map((l) => l.name)).not.toContain("https-platform-mcp");
    expect(RESOURCES.filter((r) => r.type === TYPE.dns).map((r) => r.inputs.name)).not.toContain(HOST);
    expect(RESOURCES.filter((r) => r.name.includes("platform-mcp"))).toEqual([]);
  });
});

describe("loadMcpGateway refuses a gateway it cannot gate", () => {
  const load = (values: Record<string, string>, langfuse = true, authkit = "tenant.authkit.app") => {
    pulumi.runtime.setAllConfig({ [key("mcpGatewayEnabled")]: "true", ...values });
    return loadMcpGateway(new pulumi.Config(LEGACY_PROJECT), DOMAIN, authkit, langfuse);
  };
  const complete = { [key("mcpGatewayPlatformOrgId")]: ORG, [key("mcpGatewaySessionKey")]: SESSION_KEY };

  it("names every missing dependency", () => {
    expect(() => load({}, true, "")).toThrow(/workosAuthkitDomain.*mcpGatewayPlatformOrgId.*mcpGatewaySessionKey/);
  });

  it("takes only a WorkOS organization id, never something CEL would read as code", () => {
    expect(() => load({ ...complete, [key("mcpGatewayPlatformOrgId")]: 'org_1" || true || "' })).toThrow(/org_/);
    expect(() => load({ ...complete, [key("mcpGatewayPlatformOrgId")]: "platform-external-id" })).toThrow(/org_/);
  });

  it("takes a 64-hex session key only", () => {
    expect(() => load({ ...complete, [key("mcpGatewaySessionKey")]: "short" })).toThrow(/openssl rand -hex 32/);
  });

  it("refuses to serve an empty host when Langfuse is off", () => {
    expect(() => load(complete, false)).toThrow(/Langfuse is off/);
  });

  it("derives the host and the issuer when complete", () => {
    expect(load(complete)).toMatchObject({ enabled: true, domain: HOST, issuer: "https://tenant.authkit.app", platformOrgId: ORG });
  });
});
