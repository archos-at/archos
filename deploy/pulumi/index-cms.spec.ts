import { describe, it, expect, beforeAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "./src/test-support/stack-config";
import { readFileSync } from "node:fs";
import { objectName } from "./src/names";

/** The program's project (Pulumi.yaml), the prefix of every stack key. */
const PROJECT = /^name:\s*(\S+)/m.exec(readFileSync(new URL("./Pulumi.yaml", import.meta.url), "utf8"))![1];
const key = (name: string) => `${PROJECT}:${name}`;
/** The app namespace, the Gateway and the app's S3 identity, by the names this project gives them (src/names.ts). */
const appNs = () => objectName("namespace", PROJECT);
const gatewayName = () => objectName("gateway", PROJECT);

/**
 * The website's CMS (ADR-0155), the whole program built once with it on. Each
 * assertion is a string that plans clean and is wrong only on a cluster: a
 * listener whose routes the Gateway refuses from another namespace, a CMS that
 * cannot verify its database's certificate, a bucket outside its S3 identity, a
 * NetworkPolicy that times the website out, a read-only root the server cannot
 * start on. The off side is the last block.
 */

const HOST = "cms.dev.example.test";
/** The platform Connect application the CMS host is gated by, as on every stack that runs it. */
const GATE = {
  [key("otelOidcIssuer")]: "https://grid.authkit.app",
  [key("otelOidcClientId")]: "client_otel",
  [key("otelOidcClientSecret")]: "otel-client-secret", // pragma: allowlist secret
};
const RESOURCES: Array<{ type: string; name: string; inputs: Record<string, unknown> }> = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}-id`, state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } } };
    },
    call: () => ({}),
  },
  PROJECT,
  "test",
  false,
);

type Container = {
  image: string;
  imagePullPolicy?: string;
  resources?: unknown;
  env?: Array<{ name: string; value?: string; valueFrom?: unknown }>;
  args?: string[];
  securityContext?: Record<string, unknown>;
  volumeMounts?: Array<{ name: string; mountPath: string }>;
  startupProbe?: { httpGet?: { path: string; port: number } };
};
type PodSpec = { containers: Container[]; securityContext?: Record<string, unknown>; volumes?: unknown[]; terminationGracePeriodSeconds?: number };
const find = (type: string, name: string) => {
  const hit = RESOURCES.find((r) => r.type === type && r.name === name);
  expect(hit, `${type} ${name}`).toBeDefined();
  return hit!.inputs as Record<string, any>;
};
const podOf = (type: string, name: string): PodSpec => find(type, name).spec.template.spec;
const envOf = (container: Container) => Object.fromEntries((container.env ?? []).map((e) => [e.name, e.value ?? e.valueFrom]));
const unwrap = (data: any) => (data && typeof data.value === "object" ? data.value : data);

async function build(extra: Record<string, string>) {
  RESOURCES.length = 0;
  pulumi.runtime.setAllConfig({ ...baseStackConfig(), [key("baseDomain")]: "dev.example.test", ...GATE, ...extra });
  vi.resetModules();
  const stack = (await import("./index")) as Record<string, unknown>;
  await Promise.all(
    Object.values(stack)
      .filter((v): v is pulumi.Output<unknown> => pulumi.Output.isInstance(v))
      .map((output) => new Promise((resolve) => output.apply(resolve))),
  );
}

describe("the CMS, switched on", () => {
  beforeAll(async () => {
    await build({
      [key("cmsEnabled")]: "true",
      [key("imageRegistry")]: "registry.example.test/owner",
      [key("imageTag")]: "sha-0123456789abcdef0123456789abcdef01234567",
      [key("registryUsername")]: "deploy-bot",
      [key("registryPassword")]: "placeholder-secret-value", // pragma: allowlist secret
    });
  }, 120_000);

  it("adds an https-cms listener that admits routes from the cms namespace only", () => {
    const gateway = RESOURCES.find((r) => (r.inputs as { metadata?: { name?: string } }).metadata?.name === gatewayName() && r.type.endsWith(":Gateway"))!.inputs.spec as { listeners: Array<Record<string, any>> };
    expect(gateway.listeners.find((l) => l.name === "https-cms")).toEqual({
      name: "https-cms",
      port: 443,
      protocol: "HTTPS",
      hostname: HOST,
      tls: { mode: "Terminate", certificateRefs: [{ name: "cms-tls" }] },
      allowedRoutes: { namespaces: { from: "Selector", selector: { matchLabels: { "kubernetes.io/metadata.name": "cms" } } } },
    });
  });

  it("routes the host to the CMS from the cms namespace, naming the Gateway's namespace", () => {
    const route = find("kubernetes:gateway.networking.k8s.io/v1:HTTPRoute", "cms-route");
    expect(route.metadata.namespace).toBe("cms");
    expect(route.spec.parentRefs).toEqual([{ name: gatewayName(), namespace: appNs(), sectionName: "https-cms" }]);
    expect(route.spec.hostnames).toEqual([HOST]);
    expect(route.spec.rules[0].backendRefs).toEqual([{ name: "cms", port: 3000 }]);
  });

  it("gates the host as Langfuse's is, and leaves only the images open, on a route the gate does not name", () => {
    const policy = find("kubernetes:gateway.envoyproxy.io/v1alpha1:SecurityPolicy", "cms-security-policy");
    expect(policy.metadata.namespace).toBe("cms");
    expect(policy.spec.targetRefs).toEqual([{ group: "gateway.networking.k8s.io", kind: "HTTPRoute", name: "cms" }]);
    expect(policy.spec.oidc.redirectURL).toBe(`https://${HOST}/oauth2/callback`);
    expect(policy.spec.oidc.clientSecret).toEqual({ name: "cms-oidc" });
    expect(policy.spec.oidc.forwardAccessToken).toBe(true);
    expect(policy.spec.authorization.defaultAction).toBe("Deny");
    expect(policy.spec.authorization.rules.map((r: { principal: { jwt: { scopes: string[] } } }) => r.principal.jwt.scopes)).toEqual([["platform:organizations:view"]]);
    // The Secret sits beside the policy: a SecurityPolicy reads Secrets of its own namespace only.
    expect(find("kubernetes:core/v1:Secret", "cms-oidc").metadata.namespace).toBe("cms");

    const media = find("kubernetes:gateway.networking.k8s.io/v1:HTTPRoute", "cms-media-route");
    expect(media.metadata).toMatchObject({ name: "cms-media", namespace: "cms" });
    expect(media.spec.hostnames).toEqual([HOST]);
    expect(media.spec.rules).toEqual([{ matches: [{ path: { type: "PathPrefix", value: "/api/media/file/" } }], backendRefs: [{ name: "cms", port: 3000 }] }]);
    // The CMS signs a person in from the gate's token, against the gate's issuer.
    expect(envOf(podOf("kubernetes:apps/v1:Deployment", "cms").containers[0]).CMS_EDGE_OIDC_ISSUER).toBe("https://grid.authkit.app");
  });

  it("runs the commit's own CMS image as nextjs, read-only, verifying cms-pg's certificate, with files in its own bucket", () => {
    const pod = podOf("kubernetes:apps/v1:Deployment", "cms");
    const [container] = pod.containers;
    expect(container.image).toBe("registry.example.test/owner/cms:sha-0123456789abcdef0123456789abcdef01234567");
    expect(container.imagePullPolicy).toBe("IfNotPresent");
    expect(pod.securityContext).toMatchObject({ runAsNonRoot: true, runAsUser: 1001 });
    expect(container.securityContext).toMatchObject({ readOnlyRootFilesystem: true, allowPrivilegeEscalation: false });
    // Next's cache and /tmp are the only writable paths, and the server's probe touches no database.
    expect(container.volumeMounts?.map((m) => m.mountPath).sort()).toEqual(["/app/.next/cache", "/etc/cms-pg-ca", "/tmp"]);
    expect(container.startupProbe?.httpGet).toEqual({ path: "/healthz", port: 3000 });
    const env = envOf(container);
    expect(env).toMatchObject({
      NODE_ENV: "production",
      CMS_PUBLIC_URL: `https://${HOST}`,
      CMS_S3_BUCKET: "cms-files",
      CMS_S3_ACCESS_KEY_ID: "cms",
      CMS_S3_ENDPOINT: `http://seaweedfs.${appNs()}.svc.cluster.local:8333`,
      WEBSITE_REVALIDATE_URL: `http://web.${appNs()}.svc.cluster.local:4321/api/cms/revalidate`,
      WEBSITE_PUBLIC_URL: "https://dev.example.test",
    });
    const deployment = find("kubernetes:apps/v1:Deployment", "cms").spec;
    // The policy pack: a declared singleton may Recreate, but still soaks and states its grace period.
    expect(deployment.strategy).toEqual({ type: "Recreate" });
    expect(deployment.replicas).toBe(1);
    expect(deployment.minReadySeconds).toBeGreaterThan(0);
    expect(pod.terminationGracePeriodSeconds).toBe(30);
    expect(container.resources).toMatchObject({ requests: { cpu: expect.any(String), memory: expect.any(String) }, limits: { cpu: expect.any(String), memory: expect.any(String) } });
  });

  it("keeps every credential out of the pod spec, in cms-env, and verifies the database's certificate", async () => {
    const env = envOf(podOf("kubernetes:apps/v1:Deployment", "cms").containers[0]);
    const secrets = ["PAYLOAD_SECRET", "DATABASE_URL", "CMS_S3_SECRET_ACCESS_KEY", "CMS_ADMIN_PASSWORD", "CMS_WEBSITE_API_KEY", "CMS_SOCIAL_HANDOFF_API_KEY", "WEBSITE_REVALIDATE_TOKEN", "CMS_PREVIEW_SECRET"];
    for (const key of secrets) expect(env[key], key).toBeUndefined();
    const secret = unwrap(find("kubernetes:core/v1:Secret", "cms-env").stringData);
    expect(Object.keys(secret).sort()).toEqual([...secrets].sort());
    const url = await new Promise<string>((resolve) => pulumi.output(secret.DATABASE_URL).apply(resolve));
    expect(url).toMatch(/^postgresql:\/\/cms:[^@]+@cms-pg-rw\.cms\.svc:5432\/cms\?sslmode=verify-full&sslrootcert=\/etc\/cms-pg-ca\/ca\.crt$/);
  });

  it("gives the CMS its own Postgres cluster in its namespace", () => {
    const cluster = find("kubernetes:postgresql.cnpg.io/v1:Cluster", "cms-pg");
    expect(cluster.metadata.namespace).toBe("cms");
    expect(cluster.spec.bootstrap.initdb).toMatchObject({ database: "cms", owner: "cms" });
  });

  it("lets the website, the edge and the CMS reach exactly what each needs", () => {
    const policy = (name: string) => find("kubernetes:networking.k8s.io/v1:NetworkPolicy", name).spec;
    expect(policy("cms-allow-website-to-cms").ingress[0].from[0].podSelector.matchLabels).toEqual({ "app.kubernetes.io/name": "web" });
    expect(policy("cms-allow-website-to-cms").ingress[0].ports).toEqual([{ protocol: "TCP", port: 3000 }]);
    expect(policy("cms-app-allow-cms-to-seaweedfs").ingress[0].ports).toEqual([{ protocol: "TCP", port: 8333 }]);
    expect(policy("cms-app-allow-cms-to-website").ingress[0].ports).toEqual([{ protocol: "TCP", port: 4321 }]);
    expect(policy("cms-allow-edge-to-cms").ingress[0].from[0].namespaceSelector.matchLabels).toEqual({
      "kubernetes.io/metadata.name": "envoy-gateway-system",
    });
  });

  it("hands the website the internal URL, the public one, and its credentials by reference", () => {
    const env = envOf(podOf("kubernetes:apps/v1:Deployment", "web").containers[0]);
    expect(env.CMS_URL).toBe("http://cms.cms.svc.cluster.local:3000");
    expect(env.CMS_PUBLIC_URL).toBe(`https://${HOST}`);
    expect(env.CMS_API_KEY).toEqual({ secretKeyRef: { name: "web-cms", key: "CMS_API_KEY" } });
    expect(env.CMS_REVALIDATE_TOKEN).toEqual({ secretKeyRef: { name: "web-cms", key: "CMS_REVALIDATE_TOKEN" } });
  });

  it("pulls its private image with a pull Secret of its own namespace, as the app's pods do", () => {
    // The 2026-11-05 first deploy: no Secret in `cms`, so GHCR answered 401 and the
    // pod sat in ImagePullBackOff until the apply timed out.
    const secret = find("kubernetes:core/v1:Secret", "cms-registry-pull");
    expect(secret.metadata.namespace).toBe("cms");
    expect(secret.type).toBe("kubernetes.io/dockerconfigjson");
    const pod = podOf("kubernetes:apps/v1:Deployment", "cms") as PodSpec & { imagePullSecrets?: Array<{ name: string }> };
    expect(pod.imagePullSecrets).toEqual([{ name: secret.metadata.name }]);
  });

  it("runs no config Job: the CMS migrates and provisions itself on start", () => {
    expect(RESOURCES.some((r) => r.type === "kubernetes:batch/v1:Job" && r.name.startsWith("cms-"))).toBe(false);
  });

  it("scopes the cms S3 identity to its bucket and keeps the bucket from the app's identity", () => {
    const s3 = JSON.parse(unwrap(find("kubernetes:core/v1:Secret", "seaweedfs-s3-config").stringData)["s3.json"]);
    const cms = s3.identities.find((i: { name: string }) => i.name === "cms");
    expect(cms.actions).toEqual(["Read:cms-files", "Write:cms-files", "List:cms-files", "Tagging:cms-files"]);
    const app = s3.identities.find((i: { name: string }) => i.name === appNs());
    expect(app.actions.some((a: string) => a.includes("cms-files"))).toBe(false);
  });

});

describe("the CMS, with its image set by hand", () => {
  beforeAll(async () => {
    await build({ [key("cmsEnabled")]: "true", [key("cmsImage")]: "registry.example.test/owner/cms:sha-feedfeedfeedfeedfeedfeedfeedfeedfeedfeed" });
  }, 120_000);

  it("runs that image", () => {
    expect(podOf("kubernetes:apps/v1:Deployment", "cms").containers[0].image).toBe("registry.example.test/owner/cms:sha-feedfeedfeedfeedfeedfeedfeedfeedfeedfeed");
  });
});

describe("the CMS, switched on without network policies", () => {
  beforeAll(async () => {
    await build({ [key("cmsEnabled")]: "true", [key("networkPolicies")]: "false" });
  }, 120_000);

  it("deploys nothing of it, and the website reads no CMS", () => {
    expect(RESOURCES.some((r) => r.name === "cms" || r.name === "cms-pg" || r.name === "cms-ns")).toBe(false);
    const env = envOf(podOf("kubernetes:apps/v1:Deployment", "web").containers[0]);
    expect(env.CMS_URL).toBeUndefined();
  });
});

describe("the CMS behind the platform MCP gateway", () => {
  beforeAll(async () => {
    await build({
      [key("cmsEnabled")]: "true",
      [key("langfuseEnabled")]: "false",
      [key("mcpGatewayEnabled")]: "true",
      [key("mcpGatewayPlatformOrgId")]: "org_01PLATFORM",
      [key("workosAuthkitDomain")]: "tenant.authkit.app",
    });
  }, 120_000);

  it("serves /cms/mcp with the CMS's agent key, which the gateway alone may present", async () => {
    const config = find("kubernetes:core/v1:ConfigMap", "platform-mcp-gateway-config").data["config.yaml"] as string;
    expect(config).toContain("http://cms.cms.svc.cluster.local:3000/api/mcp");
    expect(config).toContain("/var/run/secrets/mcp/cms/authorization");
    const credential = find("kubernetes:core/v1:Secret", "cms-platform-mcp");
    expect(credential.metadata.namespace).toBe(appNs());
    const header = await new Promise<string>((resolve) => pulumi.output(unwrap(credential.stringData).authorization).apply(resolve));
    expect(header).toMatch(/^Bearer [A-Za-z0-9_-]{20,}$/);
    const cmsEnv = unwrap(find("kubernetes:core/v1:Secret", "cms-env").stringData);
    const mcpKey = await new Promise<string>((resolve) => pulumi.output(cmsEnv.CMS_PLATFORM_MCP_API_KEY).apply(resolve));
    expect(header).toBe(`Bearer ${mcpKey}`);
    const allow = find("kubernetes:networking.k8s.io/v1:NetworkPolicy", "cms-allow-platform-mcp-gateway-to-cms").spec;
    expect(allow.ingress[0].from[0].podSelector.matchLabels).toEqual({ "app.kubernetes.io/name": "platform-mcp-gateway" });
    expect(allow.ingress[0].ports).toEqual([{ protocol: "TCP", port: 3000 }]);
  });

  it("runs without Langfuse and needs no session key in the stack: it is derived like the CMS's credentials", async () => {
    const session = find("kubernetes:core/v1:Secret", "platform-mcp-gateway-session");
    const value = await new Promise<string>((resolve) => pulumi.output(unwrap(session.stringData)["session-key"]).apply(resolve));
    expect(value).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the CMS, switched on while the gateway is off", () => {
  beforeAll(async () => {
    await build({ [key("cmsEnabled")]: "true" });
  }, 120_000);

  it("offers no gateway route and hands the CMS no gateway key", () => {
    expect(RESOURCES.some((r) => r.name === "cms-platform-mcp" || r.name === "cms-allow-platform-mcp-gateway-to-cms")).toBe(false);
    expect(Object.keys(unwrap(find("kubernetes:core/v1:Secret", "cms-env").stringData))).not.toContain("CMS_PLATFORM_MCP_API_KEY");
  });
});

describe("the CMS without the platform gate's application", () => {
  it("is refused rather than deployed with an open admin panel", async () => {
    await expect(build({ [key("cmsEnabled")]: "true", [key("otelOidcClientId")]: "" })).rejects.toThrow(/cmsEnabled needs the platform WorkOS Connect application/);
  }, 120_000);
});
