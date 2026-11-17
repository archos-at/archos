import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "../test-support/stack-config";
import { WORKFLOW } from "./agent-worker";
import { hatchetBacklogQuery } from "./keda-scaling";
import { TRANSFER_HPA_OWNERSHIP } from "./keda-scaling";

const repoRoot = join(__dirname, "..", "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), "utf8");

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

const DEPLOYMENT = "kubernetes:apps/v1:Deployment";
const SCALED_OBJECT = "kubernetes:keda.sh/v1alpha1:ScaledObject";
const HPA = "kubernetes:autoscaling/v2:HorizontalPodAutoscaler";

describe("the agent-worker tier", () => {
  let env: k8s.types.input.core.v1.EnvVar[] = [];
  let backendEnvVars: k8s.types.input.core.v1.EnvVar[] = [];
  let drainSeconds = 0;
  let concurrency = 0;

  beforeAll(async () => {
    pulumi.runtime.setAllConfig({
      ...baseStackConfig(),
      "grid-oib:allowPlaintextJobPayloads": "true",
      "grid-oib:observabilityEnabled": "false",
    });
    const { loadConfig } = await import("../config");
    const { installAgentWorker } = await import("./agent-worker");
    const { buildSecrets, workerEnv, backendEnv } = await import("./config");
    const { installNetworkPolicies } = await import("../platform/network-policies");
    const cfg = loadConfig();
    drainSeconds = cfg.agentWorker.drainSeconds;
    concurrency = cfg.agentWorker.concurrency;
    const provider = new k8s.Provider("test", { kubeconfig: "apiVersion: v1" });
    const wiring = {
      cfg,
      namespace: "grid",
      provider,
      redisUrl: pulumi.output("redis://dragonfly:6379"),
      seaweedInternalEndpoint: pulumi.output("http://seaweedfs:8333"),
      seaweedPublicEndpoint: pulumi.output("https://s3.example.test"),
      qdrantUrl: pulumi.output("http://qdrant.grid.svc.cluster.local:6333"),
      dsn: (opts: { db: string; clusterWide?: boolean }) => pulumi.output(`postgresql://x/${opts.db}`),
      imagePullSecrets: [],
    };
    env = workerEnv(wiring);
    backendEnvVars = backendEnv(wiring);
    const secrets = buildSecrets(wiring);
    const tier = installAgentWorker(wiring, cfg, secrets, []);
    installNetworkPolicies(cfg, provider, "grid");
    await new Promise((done) => tier.deployment.id.apply(done));
    await new Promise((done) => tier.scaledObject.id.apply(done));
  });

  it("scales on a KEDA ScaledObject and no longer has a CPU HPA", () => {
    expect(RESOURCES.filter((r) => r.type === HPA && r.name === "agent-worker")).toEqual([]);
    expect(find(SCALED_OBJECT, "agent-worker")).toBeDefined();
    expect(read("deploy", "pulumi", "src", "app", "agent-worker.ts")).not.toMatch(/HorizontalPodAutoscaler\(/);
  });

  it("asks KEDA for one replica per `concurrency` open `research-run` runs, within the configured bounds", async () => {
    const spec = await resolve(find(SCALED_OBJECT, "agent-worker").inputs.spec);

    expect(spec.triggers).toHaveLength(1);
    expect(spec.triggers[0].type).toBe("postgresql");
    expect(spec.triggers[0].metadata).toMatchObject({
      query: hatchetBacklogQuery("test", WORKFLOW),
      targetQueryValue: String(concurrency),
      activationTargetQueryValue: "0",
    });
    expect(spec.maxReplicaCount).toBeGreaterThanOrEqual(spec.minReplicaCount);
    expect(spec.advanced.horizontalPodAutoscalerConfig.behavior.scaleDown.policies[0]).toMatchObject({
      type: "Pods",
      value: 1,
    });
    expect(spec.scaleTargetRef.name).toBe("agent-worker");
  });

  it("takes over the plain HPA a stack from before KEDA still holds, instead of being refused", async () => {
    const scaled = find(SCALED_OBJECT, "agent-worker");
    const metadata = await resolve(scaled.inputs.metadata);
    const spec = await resolve(scaled.inputs.spec);

    expect(metadata.annotations).toEqual({ [TRANSFER_HPA_OWNERSHIP]: "true" });
    expect(spec.advanced.horizontalPodAutoscalerConfig.name).toBe("agent-worker");
  });

  it("counts its backlog through the TriggerAuthentication every worker tier shares", async () => {
    const spec = await resolve(find(SCALED_OBJECT, "agent-worker").inputs.spec);
    expect(WORKFLOW).toBe("research-run");
    expect(spec.triggers[0].authenticationRef.name).toBe("hatchet-queue-auth");
  });

  it("gives a pod its drain budget plus time to give back what it did not finish", async () => {
    const spec = await resolve(find(DEPLOYMENT, "agent-worker").inputs.spec);

    expect(spec.template.spec.terminationGracePeriodSeconds).toBe(drainSeconds + 30);
    expect(spec.strategy.rollingUpdate.maxUnavailable).toBe(0);
  });

  it("emits no drain variable the Hatchet worker does not read; its drain is the grace period", () => {
    const hatchetLayer = read("apps", "agent-host", "src", "agent_host", "jobs", "research_workflow.py");
    expect(hatchetLayer).not.toContain("RESEARCH_WORKER_DRAIN_SECONDS");
    expect(env.find((e) => e.name === "RESEARCH_WORKER_DRAIN_SECONDS")).toBeUndefined();
    expect(drainSeconds).toBeGreaterThan(0);
  });

  it("emits the per-organization caps the Hatchet concurrency and the admission read", () => {
    const names = new Set([...env, ...backendEnvVars].map((e) => e.name));
    const jobs = ["research_workflow.py", "orchestrator_runs.py"]
      .map((file) => read("apps", "agent-host", "src", "agent_host", "jobs", file))
      .join("\n");

    for (const name of ["MAX_ACTIVE_JOBS_PER_ORG", "MAX_QUEUED_JOBS_PER_ORG"]) {
      expect(names.has(name), name).toBe(true);
      expect(jobs).toContain(`"${name}"`);
    }
  });

  it("names no variable twice", () => {
    const names = env.map((e) => e.name as string);

    expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
  });

  it("sets its floor per stack: zero in dev, one warm worker in prod", () => {
    const prod = read("deploy", "pulumi", "Pulumi.prod.yaml");
    const dev = read("deploy", "pulumi", "Pulumi.dev.yaml");

    expect(prod).toMatch(/grid-oib:agentWorkerMinReplicas: "1"/);
    expect(dev).toMatch(/grid-oib:agentWorkerMinReplicas: "0"/);
  });
});
