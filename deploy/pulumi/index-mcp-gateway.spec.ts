import { describe, it, expect, beforeAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import Ajv2020 from "ajv/dist/2020";
import * as yaml from "js-yaml";
import { readFileSync } from "node:fs";
import { baseStackConfig, langfuseStackConfig } from "./src/test-support/stack-config";
import { checkSessionKey, loadMcpGateway } from "./src/config/mcp-gateway";
import { GATEWAY_NAME } from "./src/platform/gateway";
import { MCP_GATEWAY, toolAllowlist } from "./src/platform/mcp-gateway-config";
import { LANGFUSE_PLATFORM_TOOLS } from "./src/platform/mcp-gateway";
import { LEGACY_PROJECT, objectName } from "./src/names";

/** A stack config key of the project these specs run as. */
const key = (name: string): string => `${LEGACY_PROJECT}:${name}`;

/**
 * The platform MCP gateway (ADR-0154), the whole program built with it on and
 * with it off.
 *
 * What fails here plans clean and breaks only on a cluster or at a client: a
 * config file agentgateway refuses to load (held against its own schema at
 * the pinned tag), a token for another audience or organization let
 * through, the caller's token or the whole Langfuse Secret handed to the pod,
 * a NetworkPolicy that times out every call behind a green deploy, a host in
 * DNS with no listener.
 */

/**
 * agentgateway's published config schema at the pinned tag. CI's infra job
 * fetches it (checksum-pinned) and points `AGENTGATEWAY_SCHEMA` at it; without
 * it that one case is reported as skipped. Locally:
 * `curl -sSfLo /tmp/ag.json https://raw.githubusercontent.com/agentgateway/agentgateway/v1.7.0/schema/config.json`
 * and `AGENTGATEWAY_SCHEMA=/tmp/ag.json AGENTGATEWAY_SCHEMA_VERSION=v1.7.0`.
 */
const SCHEMA_PATH = process.env.AGENTGATEWAY_SCHEMA;

const DOMAIN = "dev.example.test";
const HOST = `platform-mcp.${DOMAIN}`;
const ORG = "org_01HPLATFORMTEST";
const SESSION_KEY = "a".repeat(64); // pragma: allowlist secret

type Resource = { type: string; name: string; inputs: Record<string, unknown> };
type Listener = { name: string; protocol: string; hostname?: string };
type Route = { spec: { parentRefs: unknown[]; hostnames: string[]; rules: unknown[] } };
type Policy = { spec: { targetRefs: Array<{ name: string; sectionName?: string }> } };
type NetworkPolicy = { spec: unknown };
type ConfigMap = { data: Record<string, string> };
type Container = {
  image: string;
  env: unknown[];
  securityContext: Record<string, unknown>;
  readinessProbe: { httpGet: unknown };
  lifecycle: unknown;
  volumeMounts: unknown[];
};
type Deployment = { spec: { replicas: number; template: { spec: { containers: Container[]; volumes: unknown[] } } } };
type AgTarget = { mcp: unknown; policies: { backendAuth?: unknown } };
type AgRoute = {
  name: string;
  matches: unknown[];
  policies: { mcpAuthentication: unknown; authorization: unknown; urlRewrite?: unknown; mcpAuthorization?: unknown };
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
  trafficPolicy: "kubernetes:gateway.envoyproxy.io/v1alpha1:BackendTrafficPolicy",
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
    [key("dnsZoneId")]: "00000000000000000000000000abc123",
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
    // Neither on the route itself nor on its listener (a Gateway-wide policy, or
    // one naming `https-platform-mcp`, would reach the route as well).
    expect(gates.map((t) => t.name)).not.toContain("platform-mcp-gateway");
    expect(
      gates.filter((t) => t.name === GATEWAY_NAME && (t.sectionName ?? "https-platform-mcp") === "https-platform-mcp"),
    ).toEqual([]);
  });

  it.skipIf(SCHEMA_PATH === undefined)("writes a config the pinned agentgateway's own schema accepts", () => {
    // The schema CI fetched is the pinned image's version, or this proves nothing.
    expect(MCP_GATEWAY.image).toContain(`:${process.env.AGENTGATEWAY_SCHEMA_VERSION}@`);
    const schema = JSON.parse(readFileSync(SCHEMA_PATH!, "utf8")) as Record<string, unknown>;
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
    ]);
  });

  it("admits the platform organization's owner role by its claims, and leaves any other organization to the app", () => {
    const other = `!request.path.startsWith("/.well-known/") && jwt.org_id != "${ORG}"`;
    expect(langfuseRoute().policies.authorization).toEqual({
      rules: [
        {
          require: `request.path.startsWith("/.well-known/") || (jwt.org_id == "${ORG}" && ("org-platform-owner" in jwt.roles)) || (${other})`,
        },
      ],
    });
    // The rule's third branch is exactly the condition under which the app is
    // asked, and the asking denies on failure: no token of another organization
    // reaches a server without the app's yes.
    expect(langfuseRoute().policies.extAuthz).toEqual({
      conditional: [
        {
          condition: other,
          host: "frontend:3000",
          protocol: { http: { path: '"/api/internal/platform-mcp-admission?role=org-platform-owner"' } },
          includeRequestHeaders: ["authorization"],
          failureMode: "deny",
          policies: {
            backendAuth: {
              key: {
                value: { file: "/var/run/secrets/mcp/admission/token" },
                location: { header: { name: "x-internal-token", prefix: "" } },
              },
            },
          },
          cache: { key: ["jwt.sub"], ttl: 'duration("60s")' },
        },
      ],
    });
  });

  it("shares the admission route's own token with the frontend, never the service token", () => {
    // A secret Output reaches the mock wrapped, under `value`.
    const { stringData } = find<{ stringData: { value?: Record<string, string> } }>("kubernetes:core/v1:Secret", "platform-mcp-admission");
    expect(Object.keys(stringData.value ?? {})).toEqual(["token"]);
    expect(stringData.value?.token).toMatch(/^[0-9a-f]{64}$/);
    expect(pod().volumes).toContainEqual({
      name: "admission",
      secret: { secretName: "platform-mcp-admission", items: [{ key: "token", path: "token" }] },
    });
    expect(pod().containers[0].volumeMounts).toContainEqual({ name: "admission", mountPath: "/var/run/secrets/mcp/admission", readOnly: true });
    const frontend = find<Deployment & { spec: { template: { spec: { containers: Array<{ env: Array<{ name: string; valueFrom?: unknown }> }> } } } }>(
      TYPE.deployment,
      "frontend",
    );
    expect(frontend.spec.template.spec.containers[0].env.find((e) => e.name === "PLATFORM_MCP_ADMISSION_TOKEN")).toEqual({
      name: "PLATFORM_MCP_ADMISSION_TOKEN",
      valueFrom: { secretKeyRef: { name: "platform-mcp-admission", key: "token" } },
    });
    // The gateway holds no other secret of the app's.
    expect(JSON.stringify(pod())).not.toContain("INTERNAL_API_TOKEN");
  });

  it("lets an operator's agent reach Langfuse's configuration tools and none that read traces (ADR-0158)", () => {
    // Traces carry every office's turns; an operator's agent vendor is no processor of them.
    expect(langfuseRoute().policies.mcpAuthorization).toEqual({
      rules: [{ allow: `mcp.tool.name in [${LANGFUSE_PLATFORM_TOOLS.map((t) => `"${t}"`).join(", ")}]` }],
    });
    // Langfuse 4.74.0's tools that hold what offices wrote, each by name.
    const tenantContent = [
      "listObservations",
      "getObservation",
      "getObservationFilterValues",
      "listScores",
      "getScore",
      "createScore",
      "listComments",
      "getComment",
      "listDatasetItems",
      "getDatasetItem",
      "listDatasetRunItems",
      "listExperimentItems",
      "listAnnotationQueueItems",
      "getAnnotationQueueItem",
      "getMedia",
      "queryMetrics",
      "runBatchEvaluation",
      "testEvaluator",
      "listAlerts",
    ];
    expect(tenantContent.filter((tool) => (LANGFUSE_PLATFORM_TOOLS as readonly string[]).includes(tool))).toEqual([]);
    expect(LANGFUSE_PLATFORM_TOOLS).toContain("getPrompt");
  });

  it("restricts no tool of a server that holds only the platform's own content, and refuses a name it cannot match literally", () => {
    const server = { name: "cms", url: "http://cms:3000/api/mcp", timeout: "120s" } as const;
    expect(toolAllowlist({ ...server, tools: "all" })).toBeUndefined();
    expect(() => toolAllowlist({ ...server, tools: ['getPrompt", "getObservation'] })).toThrow();
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

  it("traces signed-in requests to the collector as its own service, never an anonymous one", () => {
    expect(config().frontendPolicies.tracing).toMatchObject({
      host: "otel-collector:4318",
      protocol: "http",
      // Sampling runs before the token is read; the filter runs at export.
      filter: 'jwt.sub != ""',
      resources: { "service.name": '"platform-mcp-gateway"' },
    });
  });

  it("budgets each client address at the edge and retries only requests no pod received", () => {
    const spec = find<{ spec: Record<string, unknown> }>(TYPE.trafficPolicy, "platform-mcp-gateway-traffic-policy").spec;
    expect(spec.targetRefs).toEqual([
      { group: "gateway.networking.k8s.io", kind: "HTTPRoute", name: "platform-mcp-gateway" },
    ]);
    expect(spec.retry).toMatchObject({ retryOn: { triggers: ["connect-failure", "refused-stream", "reset-before-request"] } });
    const rules = (spec.rateLimit as { global: { rules: Array<{ limit: unknown }> } }).global.rules;
    expect(rules.map((r) => r.limit)).toEqual([
      { requests: 300, unit: "Minute" },
      { requests: 300, unit: "Minute" },
    ]);
  });

  it("spreads its two replicas across nodes and lets a drain take only one at a time", () => {
    const spec = find<{ spec: { template: { spec: { topologySpreadConstraints: Array<{ maxSkew: number; topologyKey: string }> } } } }>(
      TYPE.deployment,
      "platform-mcp-gateway",
    ).spec.template.spec;
    expect(spec.topologySpreadConstraints[0]).toMatchObject({ maxSkew: 1, topologyKey: "kubernetes.io/hostname" });
    const pdb = RESOURCES.find((r) => r.type === "kubernetes:policy/v1:PodDisruptionBudget" && r.name.includes("platform-mcp-gateway"));
    expect(pdb, "PodDisruptionBudget").toBeDefined();
  });

  it("is withheld from the namespace-wide allow, so only the edge reaches it", () => {
    const intra = find<{ spec: { podSelector: { matchExpressions: Array<{ values: string[] }> } } }>(
      TYPE.networkPolicy,
      "allow-same-namespace",
    ).spec;
    expect(intra.podSelector.matchExpressions[0].values).toContain("platform-mcp-gateway");
  });

  it("keeps serving for a moment after it is told to stop, while Envoy drops the endpoint", () => {
    expect(pod().containers[0].lifecycle).toEqual({ preStop: { sleep: { seconds: 5 } } });
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

  it("sets no former origin outside a domain move", () => {
    const frontend = find<Deployment & { spec: { template: { spec: { containers: Array<{ env: Array<{ name: string }> }> } } } }>(
      TYPE.deployment,
      "frontend",
    );
    expect(frontend.spec.template.spec.containers[0].env.map((e) => e.name)).not.toContain("MCP_FORMER_ORIGINS");
  });

  it("tells the frontend which servers this stack serves, for Platform → Agents", () => {
    const frontend = find<Deployment & { spec: { template: { spec: { containers: Array<{ env: Array<{ name: string; value?: string }> }> } } } }>(
      TYPE.deployment,
      "frontend",
    );
    const env = frontend.spec.template.spec.containers[0].env;
    expect(env.find((e) => e.name === "PLATFORM_MCP_SERVER_URLS")).toEqual({
      name: "PLATFORM_MCP_SERVER_URLS",
      value: `https://${HOST}/langfuse/mcp`,
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

describe("the platform MCP gateway during a domain move", () => {
  const FORMER = "old.example.test";
  const FORMER_HOST = `platform-mcp.${FORMER}`;
  beforeAll(() => build({ ...onStack(), [key("formerBaseDomain")]: FORMER }), 120_000);

  const formerRoute = (): AgRoute & { hostnames?: string[] } =>
    config().routes.find((r) => r.name === "langfuse-platform-mcp-old-example-test")!;

  it("keeps the former host: a listener, its certificate and a record, served rather than redirected", () => {
    expect(listeners().find((l) => l.name === "https-former-platform-mcp")).toMatchObject({
      hostname: FORMER_HOST,
      tls: { mode: "Terminate", certificateRefs: [{ name: objectName("formerPlatformMcpTls") }] },
    });
    const records = RESOURCES.filter((r) => r.type === TYPE.dns).map((r) => r.inputs.name as string);
    const hosts = listeners()
      .filter((l) => l.protocol === "HTTPS" && l.hostname !== undefined)
      .map((l) => l.hostname as string);
    expect(records).toContain(FORMER_HOST);
    expect([...records].sort()).toEqual([...hosts].sort());
  });

  it("routes both hosts to the gateway through the one route, so its edge budget covers both", () => {
    const spec = find<Route>(TYPE.route, "platform-mcp-gateway-route").spec;
    expect(spec.parentRefs).toEqual([
      { name: GATEWAY_NAME, sectionName: "https-platform-mcp" },
      { name: GATEWAY_NAME, sectionName: "https-former-platform-mcp" },
    ]);
    expect(spec.hostnames).toEqual([HOST, FORMER_HOST]);
  });

  it("answers the former host under its own resource, and takes either host's token on both", () => {
    const current = `https://${HOST}/langfuse/mcp`;
    const former = `https://${FORMER_HOST}/langfuse/mcp`;
    expect(formerRoute().hostnames).toEqual([FORMER_HOST]);
    expect(formerRoute().policies.mcpAuthentication).toMatchObject({
      audiences: [current, former],
      resourceMetadata: { resource: former },
    });
    expect(langfuseRoute()).not.toHaveProperty("hostnames");
    expect(langfuseRoute().policies.mcpAuthentication).toMatchObject({
      audiences: [current, former],
      resourceMetadata: { resource: current },
    });
    // The same gate and the same server: only the host's identity differs.
    expect(formerRoute().policies.authorization).toEqual(langfuseRoute().policies.authorization);
    expect(formerRoute().backends).toEqual(langfuseRoute().backends);
    expect(formerRoute().matches).toEqual(langfuseRoute().matches);
  });

  it("tells the frontend the app's former origin, so its doors take and name that host too, and only the current host on Platform → Agents", () => {
    const frontend = find<Deployment & { spec: { template: { spec: { containers: Array<{ env: Array<{ name: string; value?: string }> }> } } } }>(
      TYPE.deployment,
      "frontend",
    );
    const env = frontend.spec.template.spec.containers[0].env;
    expect(env.filter((e) => e.name === "MCP_FORMER_ORIGINS")).toEqual([{ name: "MCP_FORMER_ORIGINS", value: `https://app.${FORMER}` }]);
    expect(env.find((e) => e.name === "PLATFORM_MCP_SERVER_URLS")?.value).toBe(`https://${HOST}/langfuse/mcp`);
  });

  it.skipIf(SCHEMA_PATH === undefined)("still writes a config the pinned agentgateway's own schema accepts", () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH!, "utf8")) as Record<string, unknown>;
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    ajv.validate(schema, config());
    expect(ajv.errors ?? []).toEqual([]);
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

  it("takes a 64-hex session key only, checked where the secret resolves", () => {
    expect(() => checkSessionKey("short")).toThrow(/openssl rand -hex 32/);
    expect(() => checkSessionKey("A".repeat(64))).toThrow(/lowercase hex/);
    expect(checkSessionKey(` ${SESSION_KEY}\n`)).toBe(SESSION_KEY);
  });

  it("refuses to serve an empty host when Langfuse is off", () => {
    expect(() => load(complete, false)).toThrow(/Langfuse is off/);
  });

  it("takes a bare hostname only, never a URL", () => {
    expect(() => load({ ...complete, [key("mcpGatewayDomain")]: "https://platform-mcp.example.test" })).toThrow(/bare lowercase hostname/);
    expect(() => load({ ...complete, [key("mcpGatewayDomain")]: "" })).toThrow(/bare lowercase hostname/);
  });

  it("derives the host and the issuer when complete", () => {
    expect(load(complete)).toMatchObject({ enabled: true, domain: HOST, issuer: "https://tenant.authkit.app", platformOrgId: ORG });
  });
});
