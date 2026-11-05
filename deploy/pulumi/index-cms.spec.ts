import { describe, it, expect, beforeAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "./src/test-support/stack-config";
import { cmsConfigFiles, cmsConfigScript } from "./src/platform/cms-config-job";

/**
 * The website's CMS (ADR-0155), the whole program built once with it on and
 * licensed. Each assertion is a string that plans clean and is wrong only on a
 * cluster: a listener whose routes the Gateway refuses from another namespace,
 * a Directus that cannot verify its database's certificate, a bucket outside
 * its S3 identity, a NetworkPolicy that times the website out, a config Job
 * that pushes nothing. The off side is the last block.
 */

const HOST = "cms.dev.example.test";
const RESOURCES: Array<{ type: string; name: string; inputs: Record<string, unknown> }> = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}-id`, state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } } };
    },
    call: () => ({}),
  },
  "grid-oib",
  "test",
  false,
);

type Container = { image: string; resources?: unknown; env?: Array<{ name: string; value?: string; valueFrom?: unknown }>; args?: string[] };
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
  pulumi.runtime.setAllConfig({ ...baseStackConfig(), "grid-oib:baseDomain": "dev.example.test", ...extra });
  vi.resetModules();
  const stack = (await import("./index")) as Record<string, unknown>;
  await Promise.all(
    Object.values(stack)
      .filter((v): v is pulumi.Output<unknown> => pulumi.Output.isInstance(v))
      .map((output) => new Promise((resolve) => output.apply(resolve))),
  );
}

describe("the CMS, switched on and licensed", () => {
  beforeAll(async () => {
    await build({ "grid-oib:cmsEnabled": "true", "grid-oib:cmsLicenseKey": "oig-key" }); // pragma: allowlist secret
  }, 120_000);

  it("adds an https-cms listener that admits routes from the cms namespace only", () => {
    const gateway = RESOURCES.find((r) => r.name === "grid-gateway")!.inputs.spec as { listeners: Array<Record<string, any>> };
    expect(gateway.listeners.find((l) => l.name === "https-cms")).toEqual({
      name: "https-cms",
      port: 443,
      protocol: "HTTPS",
      hostname: HOST,
      tls: { mode: "Terminate", certificateRefs: [{ name: "cms-tls" }] },
      allowedRoutes: { namespaces: { from: "Selector", selector: { matchLabels: { "kubernetes.io/metadata.name": "cms" } } } },
    });
  });

  it("routes the host to Directus from the cms namespace, naming the Gateway's namespace", () => {
    const route = find("kubernetes:gateway.networking.k8s.io/v1:HTTPRoute", "cms-route");
    expect(route.metadata.namespace).toBe("cms");
    expect(route.spec.parentRefs).toEqual([{ name: "grid-gateway", namespace: "grid", sectionName: "https-cms" }]);
    expect(route.spec.hostnames).toEqual([HOST]);
    expect(route.spec.rules[0].backendRefs).toEqual([{ name: "directus", port: 8055 }]);
  });

  it("runs the pinned Directus as node, verifying cms-pg's certificate, with files in its own bucket", () => {
    const pod = podOf("kubernetes:apps/v1:Deployment", "directus");
    const [container] = pod.containers;
    expect(container.image).toMatch(/^directus\/directus:12\.6\.1@sha256:[0-9a-f]{64}$/);
    expect(pod.securityContext).toMatchObject({ runAsNonRoot: true, runAsUser: 1000 });
    const env = envOf(container);
    expect(env).toMatchObject({
      PUBLIC_URL: `https://${HOST}`,
      DB_HOST: "cms-pg-rw.cms.svc",
      DB_SSL__CA_FILE: "/etc/cms-pg-ca/ca.crt",
      STORAGE_S3_BUCKET: "cms-files",
      STORAGE_S3_KEY: "cms",
      STORAGE_S3_ENDPOINT: "http://seaweedfs.grid.svc.cluster.local:8333",
      WEBSITE_REVALIDATE_URL: "http://web.grid.svc.cluster.local:4321/api/cms/revalidate",
    });
    const deployment = find("kubernetes:apps/v1:Deployment", "directus").spec;
    // The policy pack: a declared singleton may Recreate, but still soaks and states its grace period.
    expect(deployment.strategy).toEqual({ type: "Recreate" });
    expect(deployment.replicas).toBe(1);
    expect(deployment.minReadySeconds).toBeGreaterThan(0);
    expect(pod.terminationGracePeriodSeconds).toBe(30);
    expect(container.resources).toMatchObject({ requests: { cpu: expect.any(String), memory: expect.any(String) }, limits: { cpu: expect.any(String), memory: expect.any(String) } });
  });

  it("keeps every credential out of the pod spec, in cms-env", () => {
    const env = envOf(podOf("kubernetes:apps/v1:Deployment", "directus").containers[0]);
    for (const key of ["SECRET", "LICENSE_KEY", "ADMIN_PASSWORD", "ADMIN_TOKEN", "DB_PASSWORD", "STORAGE_S3_SECRET"]) {
      expect(env[key], key).toBeUndefined();
    }
    const secret = unwrap(find("kubernetes:core/v1:Secret", "cms-env").stringData);
    expect(Object.keys(secret).sort()).toEqual(
      ["ADMIN_PASSWORD", "ADMIN_TOKEN", "DB_PASSWORD", "LICENSE_KEY", "SECRET", "STORAGE_S3_SECRET", "WEBSITE_REVALIDATE_TOKEN"].sort(),
    );
  });

  it("gives the CMS its own Postgres cluster in its namespace", () => {
    const cluster = find("kubernetes:postgresql.cnpg.io/v1:Cluster", "cms-pg");
    expect(cluster.metadata.namespace).toBe("cms");
    expect(cluster.spec.bootstrap.initdb).toMatchObject({ database: "directus", owner: "directus" });
  });

  it("lets the website, the edge and Directus reach exactly what each needs", () => {
    const policy = (name: string) => find("kubernetes:networking.k8s.io/v1:NetworkPolicy", name).spec;
    expect(policy("cms-allow-website-to-directus").ingress[0].from[0].podSelector.matchLabels).toEqual({ "app.kubernetes.io/name": "web" });
    expect(policy("cms-app-allow-cms-to-seaweedfs").ingress[0].ports).toEqual([{ protocol: "TCP", port: 8333 }]);
    expect(policy("cms-app-allow-cms-to-website").ingress[0].ports).toEqual([{ protocol: "TCP", port: 4321 }]);
    expect(policy("cms-allow-edge-to-directus").ingress[0].from[0].namespaceSelector.matchLabels).toEqual({
      "kubernetes.io/metadata.name": "envoy-gateway-system",
    });
  });

  it("hands the website the internal URL, the public one, and its tokens by reference", () => {
    const env = envOf(podOf("kubernetes:apps/v1:Deployment", "web").containers[0]);
    expect(env.CMS_URL).toBe("http://directus.cms.svc.cluster.local:8055");
    expect(env.CMS_PUBLIC_URL).toBe(`https://${HOST}`);
    expect(env.CMS_TOKEN).toEqual({ secretKeyRef: { name: "web-cms", key: "CMS_TOKEN" } });
  });

  it("scopes the cms S3 identity to its bucket and keeps the bucket from the app's identity", () => {
    const s3 = JSON.parse(unwrap(find("kubernetes:core/v1:Secret", "seaweedfs-s3-config").stringData)["s3.json"]);
    const cms = s3.identities.find((i: { name: string }) => i.name === "cms");
    expect(cms.actions).toEqual(["Read:cms-files", "Write:cms-files", "List:cms-files", "Tagging:cms-files"]);
    const app = s3.identities.find((i: { name: string }) => i.name === "grid");
    expect(app.actions.some((a: string) => a.includes("cms-files"))).toBe(false);
  });

  it("pushes the sync files with the pinned CLI, then provisions, in a Job named by their hash", () => {
    const job = RESOURCES.find((r) => r.type === "kubernetes:batch/v1:Job" && r.name.startsWith("cms-config-"));
    expect(job?.name).toMatch(/^cms-config-[0-9a-f]{10}$/);
    const script = (job!.inputs as any).spec.template.spec.containers[0].args[0] as string;
    expect(script).toContain("npx --yes @directus/cli@12.5.0 sync push --to cluster --yes --no-interactive");
    expect(script).toContain("node scripts/provision.mjs");
  });
});

describe("the CMS's config files", () => {
  it("carry every sync file and the profile the Job pushes to, and never an id map", () => {
    const files = cmsConfigFiles();
    expect(Object.keys(files)).toContain("directus/default/schema/metadata.json");
    expect(Object.keys(files)).toContain("directus/default/data/directus-permissions_0b260eeb2c129ffe.json");
    expect(Object.keys(files).some((f) => f.endsWith("id_map.json"))).toBe(false);
    expect(JSON.parse(files["directus.config.json"]).profiles.cluster.url).toBe("http://directus.cms.svc.cluster.local:8055");
    expect(cmsConfigScript("12.5.0")).toMatch(/^set -eu/);
  });
});

describe("the CMS, switched on without a license", () => {
  beforeAll(async () => {
    await build({ "grid-oib:cmsEnabled": "true" });
  }, 120_000);

  it("deploys nothing of it, and the website reads no CMS", () => {
    expect(RESOURCES.some((r) => r.name === "directus" || r.name === "cms-pg" || r.name === "cms-ns")).toBe(false);
    const env = envOf(podOf("kubernetes:apps/v1:Deployment", "web").containers[0]);
    expect(env.CMS_URL).toBeUndefined();
  });
});
