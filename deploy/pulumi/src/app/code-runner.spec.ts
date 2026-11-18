import { describe, it, expect, beforeAll } from "vitest";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "../test-support/stack-config";

const RESOURCES: Array<{ type: string; name: string; inputs: Record<string, any> }> = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      return {
        id: `${args.name}-id`,
        state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } },
      };
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
type EnvVar = k8s.types.input.core.v1.EnvVar;

async function envValue(env: EnvVar[], name: string): Promise<string | undefined> {
  const hit = env.find((e) => e.name === name);
  return hit ? resolve(hit.value as pulumi.Input<string>) : undefined;
}

describe("code-runner", () => {
  const env: Record<"chat" | "worker" | "api" | "ingest" | "chatOff", EnvVar[]> = {
    chat: [], worker: [], api: [], ingest: [], chatOff: [],
  };
  let defaults: Awaited<ReturnType<typeof import("../config")["loadConfig"]>> = undefined as never;

  beforeAll(async () => {
    pulumi.runtime.setAllConfig({
      ...baseStackConfig(),
      "grid-oib:observabilityEnabled": "false",
      "grid-oib:codeRunnerEnabled": "true",
    });
    const { loadConfig } = await import("../config");
    const { installCodeRunner, installCodeRunnerScaling } = await import("./code-runner");
    const { installNetworkPolicies } = await import("../platform/network-policies");
    const { chatEnv, workerEnv, apiEnv, ingestWorkerEnv } = await import("./config");
    const cfg = loadConfig();
    defaults = cfg;
    const provider = new k8s.Provider("test", { kubeconfig: "apiVersion: v1" });
    const runner = installCodeRunner(cfg, provider, "grid", [], [{ name: "pull" }]);
    installCodeRunnerScaling(cfg, provider, "grid", runner, []);
    installNetworkPolicies(cfg, provider, "grid");
    const wiring = {
      cfg,
      namespace: "grid",
      provider,
      redisUrl: pulumi.output("redis://dragonfly:6379"),
      seaweedInternalEndpoint: pulumi.output("http://seaweedfs:8333"),
      seaweedPublicEndpoint: pulumi.output("https://s3.example.test"),
      qdrantUrl: pulumi.output("http://qdrant.grid.svc.cluster.local:6333"),
      dsn: () => pulumi.output("postgresql://x"),
      imagePullSecrets: [],
    };
    const on = { ...wiring, codeRunnerUrl: runner.url };
    env.chat = chatEnv(on);
    env.worker = workerEnv(on);
    env.api = apiEnv(on);
    env.ingest = ingestWorkerEnv(on, "/tmp/alive");
    env.chatOff = chatEnv(wiring);
    await new Promise((done) => runner.service.id.apply(done));
  });

  it("is off by default, from the registry the app images come from", async () => {
    const { loadCodeRunner } = await import("../config/code-runner");
    const images = { registry: "ghcr.io/archos-at", tag: "sha-abc" };
    const config = (values: Record<string, string>) =>
      ({
        get: (k: string) => values[k],
        getNumber: (k: string) => (values[k] === undefined ? undefined : Number(values[k])),
        getBoolean: (k: string) => (values[k] === undefined ? undefined : values[k] === "true"),
      }) as never;

    const off = loadCodeRunner(config({}), images);
    expect(off.enabled).toBe(false);
    expect(off.image).toBe("ghcr.io/archos-at/code-runner:sha-abc");
    expect(off.minReplicas).toBe(2);
    expect(off.maxReplicas).toBe(10);
    expect(loadCodeRunner(config({ codeRunnerImage: "r/x@sha256:1" }), images).image).toBe("r/x@sha256:1");
    expect(() => loadCodeRunner(config({ codeRunnerMinReplicas: "3", codeRunnerMaxReplicas: "2" }), images)).toThrow(
      /codeRunnerMaxReplicas/,
    );
  });

  it("runs non-root with a read-only root, no token, no service links, no env and no secret", async () => {
    const spec = await resolve(find(DEPLOYMENT, "code-runner").inputs.spec);
    const pod = spec.template.spec;
    const c = pod.containers[0];

    expect(c.image).toBe(defaults.codeRunner.image);
    expect(pod.automountServiceAccountToken).toBe(false);
    expect(pod.enableServiceLinks).toBe(false);
    expect(pod.securityContext).toMatchObject({ runAsNonRoot: true, runAsUser: 1001, runAsGroup: 1001 });
    expect(c.securityContext).toEqual({
      allowPrivilegeEscalation: false,
      privileged: false,
      capabilities: { drop: ["ALL"] },
      seccompProfile: { type: "RuntimeDefault" },
      readOnlyRootFilesystem: true,
    });
    expect(c.env).toBeUndefined();
    expect(c.envFrom).toBeUndefined();
    expect(pod.volumes.some((v: { secret?: unknown; projected?: unknown }) => v.secret || v.projected)).toBe(false);
    expect(c.readinessProbe.httpGet).toEqual({ path: "/health", port: 8080 });
    expect(c.livenessProbe.httpGet).toEqual({ path: "/health", port: 8080 });
  });

  it("gives a run a memory-backed work directory and a scratch /tmp, nothing on a disk that outlives the pod", async () => {
    const spec = await resolve(find(DEPLOYMENT, "code-runner").inputs.spec);
    const pod = spec.template.spec;
    const mounts = pod.containers[0].volumeMounts;

    expect(pod.volumes).toEqual([
      { name: "work", emptyDir: { medium: "Memory", sizeLimit: "1Gi" } },
      { name: "tmp", emptyDir: { sizeLimit: "64Mi" } },
    ]);
    expect(mounts).toEqual([
      { name: "work", mountPath: "/run/code-runner/do" },
      { name: "tmp", mountPath: "/tmp" },
    ]);
  });

  it("requests 1 vCPU and 1 GiB, limited to 4 GiB for four slots at their memory cap", async () => {
    const spec = await resolve(find(DEPLOYMENT, "code-runner").inputs.spec);
    const r = spec.template.spec.containers[0].resources;
    expect(r.requests).toEqual({ cpu: "1", memory: "1Gi" });
    expect(r.limits.memory).toBe("4Gi");
    expect(r.limits.cpu).toBeDefined();
  });

  it("lets a run of up to 180 s finish at a rollout, and surges instead of dipping", async () => {
    const spec = await resolve(find(DEPLOYMENT, "code-runner").inputs.spec);
    const pod = spec.template.spec;
    const { LONGEST_RUN_SECONDS } = await import("./code-runner");
    expect(LONGEST_RUN_SECONDS).toBe(180);
    expect(pod.terminationGracePeriodSeconds).toBeGreaterThan(5 + LONGEST_RUN_SECONDS);
    expect(pod.containers[0].lifecycle.preStop.sleep.seconds).toBe(5);
    expect(spec.strategy.rollingUpdate.maxUnavailable).toBe(0);
  });

  it("admits the agent tiers alone on 8080, and denies every egress, DNS included", async () => {
    const pol = await resolve(find(NETPOL, "code-runner-agent-only").inputs.spec);
    expect(pol.podSelector).toEqual({ matchLabels: { "app.kubernetes.io/name": "code-runner" } });
    expect(pol.policyTypes).toEqual(["Ingress", "Egress"]);
    expect(pol.egress).toEqual([]);
    expect(pol.ingress).toEqual([
      {
        from: ["aiq-agent", "chat", "agent-worker"].map((name) => ({
          podSelector: { matchLabels: { "app.kubernetes.io/name": name } },
        })),
        ports: [{ protocol: "TCP", port: 8080 }],
      },
    ]);

    const intra = await resolve(find(NETPOL, "allow-same-namespace").inputs.spec);
    expect(intra.podSelector.matchExpressions[0].values).toContain("code-runner");
  });

  it("scales between two and ten pods on CPU and memory", async () => {
    const so = find("kubernetes:keda.sh/v1alpha1:ScaledObject", "code-runner").inputs;
    const spec = await resolve(so.spec);
    expect(spec.minReplicaCount).toBe(2);
    expect(spec.maxReplicaCount).toBe(10);
    expect(await resolve(spec.scaleTargetRef.name)).toBe("code-runner");
    expect(spec.triggers.map((t: { type: string }) => t.type)).toEqual(["cpu", "memory"]);
    expect(spec.triggers.every((t: { metricType: string }) => t.metricType === "Utilization")).toBe(true);

    const deployment = await resolve(find(DEPLOYMENT, "code-runner").inputs.spec);
    expect(deployment.replicas).toBe(2);
  });

  it("hands its address to the chat tier and agent-worker, and to no other pod", async () => {
    const svc = await resolve(find("kubernetes:core/v1:Service", "code-runner").inputs.spec);
    expect(svc.ports[0].port).toBe(8080);

    expect(await envValue(env.chat, "CODE_RUNNER_URL")).toBe("http://code-runner:8080");
    expect(await envValue(env.worker, "CODE_RUNNER_URL")).toBe("http://code-runner:8080");
    expect(await envValue(env.api, "CODE_RUNNER_URL")).toBeUndefined();
    expect(await envValue(env.ingest, "CODE_RUNNER_URL")).toBeUndefined();
    expect(await envValue(env.chatOff, "CODE_RUNNER_URL")).toBeUndefined();
  });
});
