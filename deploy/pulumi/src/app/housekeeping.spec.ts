import { describe, it, expect, beforeAll } from "vitest";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "../test-support/stack-config";

const CRONJOB = "kubernetes:batch/v1:CronJob";
const RESOURCES: Array<{ type: string; name: string; inputs: Record<string, any> }> = [];

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

const API_HOUSEKEEPING = "http://api:8000/v1/maintenance/housekeeping/";
const HOUSEKEEPING_ROUTES = ["base-corpus", "chat-checkpoints", "ghost-jobs", "job-events"];

function resolve<T>(value: pulumi.Input<T>): Promise<T> {
  return new Promise((done) => pulumi.output(value).apply((v) => done(v as T)));
}

type Sweep = { name: string; url: string };
let sweeps: Sweep[] = [];

describe("the backend housekeeping CronJobs", () => {
  beforeAll(async () => {
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), "grid-oib:observabilityEnabled": "false" });
    const { loadConfig } = await import("../config");
    const { buildSecrets } = await import("./config");
    const { installWorkers } = await import("./workers");

    const cfg = loadConfig();
    const provider = new k8s.Provider("test", { kubeconfig: "apiVersion: v1" });
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
    const secrets = buildSecrets(wiring as never);
    const workers = installWorkers(wiring as never, cfg, secrets, []);
    await Promise.all(workers.housekeeping.map((job) => new Promise((done) => job.id.apply(done))));

    for (const r of RESOURCES.filter((r) => r.type === CRONJOB && r.name.startsWith("housekeeping-"))) {
      const spec = await resolve<any>(r.inputs.spec);
      const env: Array<{ name: string; value?: string }> = spec.jobTemplate.spec.template.spec.containers[0].env;
      sweeps.push({ name: r.name, url: env.find((e) => e.name === "SWEEP_URL")?.value ?? "" });
    }
  }, 120_000);

  it("run one CronJob for each of the four housekeeping routes", () => {
    expect(sweeps).toHaveLength(HOUSEKEEPING_ROUTES.length);
    expect(sweeps.map((s) => s.url.slice(API_HOUSEKEEPING.length)).sort()).toEqual(HOUSEKEEPING_ROUTES);
  });

  it("call each route on the api role", () => {
    for (const sweep of sweeps) expect(sweep.url, sweep.name).toMatch(/^http:\/\/api:8000\/v1\/maintenance\/housekeeping\/[a-z-]+$/);
  });
});
