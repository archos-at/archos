import { describe, it, expect, beforeAll } from "vitest";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "../test-support/stack-config";

const RESOURCES: Array<{ type: string; name: string; inputs: Record<string, any> }> = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      const state = { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } };
      if (args.type === "kubernetes:core/v1:Service") state.spec = { ...args.inputs.spec, clusterIP: "10.43.0.42" };
      return { id: `${args.name}-id`, state };
    },
    call: () => ({}),
  },
  "grid-oib",
  "test",
  false,
);

function find(type: string, name: string) {
  const hit = RESOURCES.find((r) => r.type === type && r.name === name);
  if (!hit) throw new Error(`no ${type} named "${name}"`);
  return hit;
}

function resolve<T>(value: pulumi.Input<T>): Promise<T> {
  return new Promise((done) => pulumi.output(value).apply((v) => done(v as T)));
}

const NETPOL = "kubernetes:networking.k8s.io/v1:NetworkPolicy";
const DEPLOYMENT = "kubernetes:apps/v1:Deployment";

const config = (values: Record<string, string>) =>
  ({
    get: (k: string) => values[k],
    getNumber: (k: string) => (values[k] === undefined ? undefined : Number(values[k])),
    getBoolean: (k: string) => (values[k] === undefined ? undefined : values[k] === "true"),
  }) as never;

describe("browser-renderer", () => {
  let defaults: Awaited<ReturnType<typeof import("../config")["loadConfig"]>> = undefined as never;

  beforeAll(async () => {
    pulumi.runtime.setAllConfig({
      ...baseStackConfig(),
      "grid-oib:observabilityEnabled": "false",
      "grid-oib:codeRunnerEnabled": "true",
      "grid-oib:browserRendererEnabled": "true",
    });
    const { loadConfig } = await import("../config");
    const { installBrowserRenderer, installBrowserRendererScaling } = await import("./browser-renderer");
    const { installCodeRunner } = await import("./code-runner");
    const { installNetworkPolicies } = await import("../platform/network-policies");
    const cfg = loadConfig();
    defaults = cfg;
    const provider = new k8s.Provider("test", { kubeconfig: "apiVersion: v1" });
    const renderer = installBrowserRenderer(cfg, provider, "grid", [], [{ name: "pull" }]);
    const scaling = installBrowserRendererScaling(cfg, provider, "grid", renderer, []);
    const runner = installCodeRunner(cfg, provider, "grid", [], [{ name: "pull" }], renderer.addr);
    installNetworkPolicies(cfg, provider, "grid");
    await Promise.all([runner.deployment, runner.service, scaling].map((r) => new Promise((done) => r.id.apply(done))));
  });

  it("is off by default, needs the code runner, and comes from the registry the app images come from", async () => {
    const { loadBrowserRenderer } = await import("../config/browser-renderer");
    const images = { registry: "ghcr.io/archos-at", tag: "sha-abc" };
    const off = loadBrowserRenderer(config({}), images, true);
    expect(off.enabled).toBe(false);
    expect(off.image).toBe("ghcr.io/archos-at/browser-renderer:sha-abc");
    expect([off.minReplicas, off.maxReplicas, off.sessionsPerPod]).toEqual([1, 3, 2]);
    expect(loadBrowserRenderer(config({ browserRendererImage: "r/x@sha256:1" }), images, true).image).toBe("r/x@sha256:1");
    expect(() => loadBrowserRenderer(config({ browserRendererEnabled: "true" }), images, false)).toThrow(/codeRunnerEnabled/);
    expect(() =>
      loadBrowserRenderer(config({ browserRendererMinReplicas: "3", browserRendererMaxReplicas: "2" }), images, true),
    ).toThrow(/browserRendererMaxReplicas/);
  });

  it("runs non-root with a read-only root, no capabilities, no privilege escalation, no token and no secret", async () => {
    const spec = await resolve(find(DEPLOYMENT, "browser-renderer").inputs.spec);
    const pod = spec.template.spec;
    const c = pod.containers[0];
    expect(c.image).toBe(defaults.browserRenderer.image);
    expect(pod.automountServiceAccountToken).toBe(false);
    expect(pod.enableServiceLinks).toBe(false);
    expect(pod.securityContext).toMatchObject({ runAsNonRoot: true, runAsUser: 10042, runAsGroup: 10042 });
    expect(c.securityContext).toEqual({
      allowPrivilegeEscalation: false,
      privileged: false,
      capabilities: { drop: ["ALL"] },
      readOnlyRootFilesystem: true,
      seccompProfile: { type: "RuntimeDefault" },
    });
    expect(c.envFrom).toBeUndefined();
    expect(c.env.map((e: { name: string }) => e.name).sort()).toEqual(["BROWSER_RENDERER_SESSIONS", "BROWSER_RENDERER_WORK_DIR", "PORT"]);
    expect(c.env.find((e: { name: string }) => e.name === "BROWSER_RENDERER_SESSIONS").value).toBe("2");
    expect(pod.volumes).toEqual([{ name: "tmp", emptyDir: { medium: "Memory", sizeLimit: "512Mi" } }]);
    expect(c.volumeMounts).toEqual([{ name: "tmp", mountPath: "/tmp" }]);
    expect(c.readinessProbe.httpGet).toEqual({ path: "/health", port: 9222 });
  });

  it("bounds CPU and memory, and outlasts the longest render at a rollout", async () => {
    const spec = await resolve(find(DEPLOYMENT, "browser-renderer").inputs.spec);
    const pod = spec.template.spec;
    expect(pod.containers[0].resources).toEqual({ requests: { cpu: "500m", memory: "512Mi" }, limits: { cpu: "2", memory: "1536Mi" } });
    expect(pod.terminationGracePeriodSeconds).toBeGreaterThan(190);
    expect(spec.strategy.rollingUpdate.maxUnavailable).toBe(0);
  });

  it("has no PodDisruptionBudget, so one replica never blocks a node drain", () => {
    expect(RESOURCES.some((r) => r.type === "kubernetes:policy/v1:PodDisruptionBudget" && r.name.includes("browser-renderer"))).toBe(false);
  });

  it("scales between one and three pods on CPU and memory", async () => {
    const spec = await resolve(find("kubernetes:keda.sh/v1alpha1:ScaledObject", "browser-renderer").inputs.spec);
    expect(spec.minReplicaCount).toBe(1);
    expect(spec.maxReplicaCount).toBe(3);
    expect(spec.triggers.map((t: { type: string }) => t.type)).toEqual(["cpu", "memory"]);
    expect((await resolve(find(DEPLOYMENT, "browser-renderer").inputs.spec)).replicas).toBe(1);
  });

  it("admits the code runner alone, denies every egress, and the code runner may reach it and nothing else", async () => {
    const pol = await resolve(find(NETPOL, "browser-renderer-code-runner-only").inputs.spec);
    expect(pol.policyTypes).toEqual(["Ingress", "Egress"]);
    expect(pol.egress).toEqual([]);
    expect(pol.ingress).toEqual([
      { from: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "code-runner" } } }], ports: [{ protocol: "TCP", port: 9222 }] },
    ]);
    const runner = await resolve(find(NETPOL, "code-runner-agent-only").inputs.spec);
    expect(runner.egress).toEqual([
      { to: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "browser-renderer" } } }], ports: [{ protocol: "TCP", port: 9222 }] },
    ]);
    const intra = await resolve(find(NETPOL, "allow-same-namespace").inputs.spec);
    expect(intra.podSelector.matchExpressions[0].values).toContain("browser-renderer");
  });

  it("hands the code runner its address as the Service's cluster IP, which needs no DNS", async () => {
    const spec = await resolve(find(DEPLOYMENT, "code-runner").inputs.spec);
    const env = spec.template.spec.containers[0].env;
    expect(env).toEqual([{ name: "BROWSER_RENDERER_ADDR", value: "10.43.0.42:9222" }]);
  });
});
