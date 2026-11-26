import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";
import * as pulumi from "@pulumi/pulumi";
import type { DeployConfig } from "../config";
import { ingestWorkerEnv } from "./config";
import { HEAVY_POOL, HEAVY_TIER, HEAVY_WORKFLOW, WORKFLOW, installIngestWorkerHeavy } from "./ingest-worker";
import { hatchetNamespace } from "./hatchet-env";
import { hatchetBacklogQuery } from "./keda-scaling";
import { deploymentSpec, scaledObjectSpec, type EnvVar } from "../test-support/k8s-shapes";
import { baseStackConfig } from "../test-support/stack-config";
import { heavyFileBytesEnv } from "../config/workers";

const DEPLOYMENT = "kubernetes:apps/v1:Deployment";
const SCALED = "kubernetes:keda.sh/v1alpha1:ScaledObject";

type Resource = { type: string; name: string; inputs: Record<string, unknown> };
const RESOURCES: Resource[] = [];

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

const find = (type: string, name: string): Resource => {
  const hit = RESOURCES.find((r) => r.type === type && r.name === name);
  if (!hit) throw new Error(`no ${type} named "${name}"`);
  return hit;
};

const envOf = (deployment: string): EnvVar[] =>
  deploymentSpec(find(DEPLOYMENT, deployment).inputs.spec).template.spec.containers[0]?.env ?? [];
const envValue = (env: Array<{ name?: unknown; value?: unknown }>, name: string) => env.find((e) => e.name === name)?.value;
const triggerQuery = (scaledObject: string): string | undefined =>
  scaledObjectSpec(find(SCALED, scaledObject).inputs.spec).triggers[0]?.metadata.query;

const pulumiDir = join(__dirname, "..", "..");

async function load(knobs: Record<string, string> = {}) {
  const set = { observabilityEnabled: "false", ...knobs };
  pulumi.runtime.setAllConfig({
    ...baseStackConfig(),
    ...Object.fromEntries(Object.entries(set).map(([key, value]) => [`grid-oib:${key}`, value])),
  });
  return import("../config").then((m) => m.loadConfig());
}

const stackKnob = (stackFile: string, key: string): string | undefined => {
  const { config } = parseYaml(readFileSync(join(pulumiDir, stackFile), "utf8")) as { config: Record<string, unknown> };
  const value = config[`grid-oib:${key}`];
  return value === undefined ? undefined : String(value);
};

const wiringFor = (cfg: DeployConfig) =>
  ({
    cfg,
    namespace: "grid",
    redisUrl: pulumi.output("redis://dragonfly:6379"),
    seaweedInternalEndpoint: pulumi.output("http://seaweedfs:8333"),
    seaweedPublicEndpoint: pulumi.output("https://s3.example.test"),
    qdrantUrl: pulumi.output("http://qdrant.grid.svc.cluster.local:6333"),
    dsn: () => pulumi.output("postgresql://x"),
    imagePullSecrets: [],
  }) as never;

describe("the ingest-worker tier", () => {
  beforeAll(async () => {
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), "grid-oib:observabilityEnabled": "false" });
    const stack = (await import("../../index")) as Record<string, unknown>;
    await Promise.all(
      Object.values(stack)
        .filter((v): v is pulumi.Output<unknown> => pulumi.Output.isInstance(v))
        .map((output) => new Promise((resolve) => output.apply(resolve))),
    );
  }, 120_000);

  it("scales on the backlog of the workflow the worker registers", () => {
    expect(WORKFLOW).toBe("ingest-document");
    expect(hatchetBacklogQuery("prod", WORKFLOW)).toContain("starts_with(action_id, 'prod_ingest-document:')");
    expect(triggerQuery("ingest-worker")).toBe(hatchetBacklogQuery(hatchetNamespace(), WORKFLOW));
  });

  it("runs prod wide and small on the batch group, never able to overcommit a node", async () => {
    const knob = (key: string) => stackKnob("Pulumi.prod.yaml", key);
    const gib = (value: string | undefined) => Number(value?.replace(/Gi$/, ""));

    expect(knob("nodeGroupBatch")).toBe("batch");
    expect(knob("ingestWorkerMaxReplicas")).toBe("7");
    expect(knob("ingestWorkerConcurrency")).toBe("2");
    expect(knob("ingestWorkerRequestsMemory")).toBe(knob("ingestWorkerLimitsMemory"));
    const { heavy } = (await load()).ingestWorker;
    expect(heavy.resources.requestsMemory).toBe(heavy.resources.limitsMemory);
    const heavyGib = heavy.maxReplicas * gib(heavy.resources.limitsMemory);
    expect(Number(knob("ingestWorkerMaxReplicas")) * gib(knob("ingestWorkerLimitsMemory")) + heavyGib).toBeLessThanOrEqual(56);
  });

  it("keeps at least one ingest worker up on every stack", async () => {
    const stacks = readdirSync(pulumiDir).filter((file) => /^Pulumi\.[\w-]+\.yaml$/.test(file));
    expect(stacks).toEqual(expect.arrayContaining(["Pulumi.dev.yaml", "Pulumi.prod.yaml"]));
    for (const stack of stacks) {
      const value = stackKnob(stack, "ingestWorkerMinReplicas");
      const { minReplicas } = (await load(value === undefined ? {} : { ingestWorkerMinReplicas: value })).ingestWorker;
      expect(minReplicas, `${stack} lets the ingest tier reach zero`).toBeGreaterThanOrEqual(1);
    }
  });

  it("runs heavy files on a high-memory pool that scales on its own workflow's backlog", async () => {
    const { heavy } = (await load()).ingestWorker;
    expect(heavy).toMatchObject({ enabled: true, minReplicas: 0, maxReplicas: 1, concurrency: 1, fileBytes: 41_943_040 });
    expect(heavy.resources.limitsMemory).toBe("12Gi");
    expect(HEAVY_WORKFLOW).toBe("ingest-document-heavy");
    expect(hatchetBacklogQuery("prod", HEAVY_WORKFLOW)).toContain("'prod_ingest-document-heavy:'");
    expect("prod_ingest-document-heavy:index".startsWith("prod_ingest-document:")).toBe(false);
    expect(triggerQuery(HEAVY_TIER)).toBe(hatchetBacklogQuery(hatchetNamespace(), HEAVY_WORKFLOW));
    expect(triggerQuery(HEAVY_TIER)).not.toBe(triggerQuery("ingest-worker"));
    expect(envValue(envOf(HEAVY_TIER), "INGEST_WORKER_POOL")).toBe(HEAVY_POOL);
  });

  it("sends nothing heavy while the stack has no high-memory pool", async () => {
    const cfg = await load({ ingestWorkerHeavyEnabled: "false" });
    expect(installIngestWorkerHeavy({} as never, cfg, {} as never, [])).toBeUndefined();
    expect(heavyFileBytesEnv(cfg.ingestWorker)).toBe(0);
    expect(envValue(ingestWorkerEnv(wiringFor(cfg), "/tmp/liveness"), "INGEST_HEAVY_FILE_BYTES")).toBe("0");
  });

  it("runs with the ingest-worker process role", () => {
    expect(envValue(envOf("ingest-worker"), "PROCESS_ROLE")).toBe("ingest-worker");
  });

  it("passes the raster pixel budget from the config to the worker", async () => {
    const cfg = await load();
    expect(cfg.ingestWorker.maxImagePixels).toBeGreaterThan(0);
    expect(envValue(envOf("ingest-worker"), "MAX_IMAGE_PIXELS")).toBe(String(cfg.ingestWorker.maxImagePixels));
  });
});
