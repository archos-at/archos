import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "./test-support/stack-config";

/**
 * The one OpenRouter key's budget (ADR-0076, ADR-0081), as the stack files state it.
 *
 * Vision calls are held to `VLM_FLEET_CONCURRENCY` fleet-wide whatever the
 * replica count: the lease pool caps the calls, and each file's page-read pool
 * (`INGEST_PAGE_READ_PARALLELISM`) bounds only its threads and memory. An ingest
 * tier with more documents at once than the pool has slots only queues: replicas
 * that hold memory and wait. The numbers are set in different places and neither
 * looks wrong alone, so the program refuses the combination.
 */

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => ({
      id: `${args.name}-id`,
      state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } },
    }),
    call: () => ({}),
  },
  "grid-oib",
  "test",
  false,
);

// src -> deploy/pulumi -> deploy -> repo root
const pulumiDir = join(__dirname, "..");
const repoRoot = join(__dirname, "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), "utf8");

async function load(config: Record<string, string> = {}) {
  pulumi.runtime.setAllConfig({
    ...baseStackConfig(),
    "grid-oib:allowPlaintextJobPayloads": "true",
    "grid-oib:observabilityEnabled": "false",
    ...config,
  });
  const [configModule, budget] = await Promise.all([import("./config"), import("./config/vlm-ceiling")]);
  return { ...budget, cfg: configModule.loadConfig() };
}

/** A knob as a stack file sets it, or the default the program falls back to. */
function stackKnob(stack: "dev" | "prod", key: string): string | undefined {
  const text = readFileSync(join(pulumiDir, `Pulumi.${stack}.yaml`), "utf8");
  return text.match(new RegExp(`^\\s*grid-oib:${key}: "?([^"\\s]+)"?\\s*$`, "m"))?.[1];
}

describe("the ingest tier's peak vision calls", () => {
  it("are the page-read threads that ask, capped by the fleet's lease pool, the high-memory pool's added", async () => {
    const { vlmPeakCalls, vlmPageReadThreads } = await load();
    const heavy = { enabled: true, maxReplicas: 2, concurrency: 1 };
    const tier = (pool: number, withHeavy = false) =>
      ({
        ingestWorker: { maxReplicas: 5, concurrency: 3, ...(withHeavy ? { heavy } : {}) },
        providerLimits: { pageReadParallelism: 16, vlmFleetConcurrency: pool },
      }) as never;

    expect(vlmPageReadThreads(tier(32))).toBe(240);
    expect(vlmPageReadThreads(tier(32, true))).toBe(272);
    expect(
      vlmPageReadThreads({
        ingestWorker: { maxReplicas: 5, concurrency: 3, heavy: { ...heavy, enabled: false } },
        providerLimits: { pageReadParallelism: 16, vlmFleetConcurrency: 32 },
      } as never),
    ).toBe(240);
    expect(vlmPeakCalls(tier(32, true))).toBe(32);
    expect(vlmPeakCalls(tier(0))).toBe(240);
  });

  it.each(["dev", "prod"] as const)("fit the %s stack's fleet pool, which fails the deploy when they do not", async (stack) => {
    const knobs = Object.fromEntries(
      [
        "ingestWorkerMaxReplicas",
        "ingestWorkerConcurrency",
        "vlmFleetConcurrency",
        "ingestPageReadParallelism",
        "providerLimitCeiling",
        "providerModelLimitCeiling",
      ]
        .map((key) => [key, stackKnob(stack, key)])
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [`grid-oib:${key}`, value as string]),
    );
    const { cfg, assertVlmPeakFitsCeiling, vlmPeakCalls } = await load(knobs);

    expect(() => assertVlmPeakFitsCeiling(cfg)).not.toThrow();
    expect(vlmPeakCalls(cfg)).toBeLessThanOrEqual(cfg.providerLimits.vlmFleetConcurrency);
  });

  it("hold the defaults too, for a stack that sets none of the knobs", async () => {
    const { cfg, assertVlmPeakFitsCeiling } = await load();

    expect(cfg.providerLimits.pageReadParallelism).toBe(16);
    expect(() => assertVlmPeakFitsCeiling(cfg)).not.toThrow();
  });

  it("fail a tier with more documents at once than the pool has slots, naming every number and what to change", async () => {
    const { cfg, assertVlmPeakFitsCeiling } = await load({ "grid-oib:ingestWorkerMaxReplicas": "12" });

    expect(() => assertVlmPeakFitsCeiling(cfg)).toThrow(
      /ingestWorkerMaxReplicas \(12\) x ingestWorkerConcurrency \(3\) \+ ingestWorkerHeavyMaxReplicas \(1\) x ingestWorkerHeavyConcurrency \(1\) = 37 documents read at once, more than vlmFleetConcurrency \(32\) vision slots/,
    );
    expect(() => assertVlmPeakFitsCeiling(cfg)).toThrow(/Lower ingestWorkerMaxReplicas to 10 or less, or raise vlmFleetConcurrency/);
  });

  it("allow documents up to the pool's slots, no more", async () => {
    const at = await load({ "grid-oib:ingestWorkerMaxReplicas": "10" });
    const over = await load({ "grid-oib:ingestWorkerMaxReplicas": "11" });

    expect(() => at.assertVlmPeakFitsCeiling(at.cfg)).not.toThrow();
    expect(() => over.assertVlmPeakFitsCeiling(over.cfg)).toThrow(/= 34 documents/);
  });

  it("follow the pool when it is raised, and refuse a file's pool larger than it", async () => {
    const raised = await load({
      "grid-oib:ingestWorkerMaxReplicas": "12",
      "grid-oib:vlmFleetConcurrency": "74",
      "grid-oib:providerModelLimitCeiling": "74",
    });
    const wider = await load({ "grid-oib:ingestPageReadParallelism": "48" });

    expect(() => raised.assertVlmPeakFitsCeiling(raised.cfg)).not.toThrow();
    expect(() => wider.assertVlmPeakFitsCeiling(wider.cfg)).toThrow(
      /ingestPageReadParallelism \(48\) is above vlmFleetConcurrency \(32\)/,
    );
  });

  it("are not held to a pool that is switched off", async () => {
    const { cfg, assertVlmPeakFitsCeiling } = await load({
      "grid-oib:vlmFleetConcurrency": "0",
      "grid-oib:ingestWorkerMaxReplicas": "40",
    });

    expect(() => assertVlmPeakFitsCeiling(cfg)).not.toThrow();
  });

  it("refuse a fleet pool larger than the key-wide limit every call passes", async () => {
    const { cfg, assertVlmPeakFitsCeiling } = await load({
      "grid-oib:vlmFleetConcurrency": "200",
      "grid-oib:providerLimitCeiling": "128",
    });

    expect(() => assertVlmPeakFitsCeiling(cfg)).toThrow(/vlmFleetConcurrency \(200\) is above providerLimitCeiling \(128\)/);
  });

  it("refuse a fleet pool larger than the vision model's own limit, which would hold its calls back", async () => {
    const { cfg, assertVlmPeakFitsCeiling } = await load({
      "grid-oib:vlmFleetConcurrency": "48",
      "grid-oib:providerModelLimitCeiling": "32",
    });

    expect(() => assertVlmPeakFitsCeiling(cfg)).toThrow(
      /vlmFleetConcurrency \(48\) is above providerModelLimitCeiling \(32\)/,
    );
  });

  it("is checked where the tier is built, so a plan that over-sizes it never reaches `pulumi up`", async () => {
    const { cfg } = await load({ "grid-oib:ingestWorkerMaxReplicas": "20" });
    const { installIngestWorker } = await import("./app/ingest-worker");
    const provider = new k8s.Provider("test", { kubeconfig: "apiVersion: v1" });
    const wiring = { cfg, namespace: "grid", provider, imagePullSecrets: [] };
    const secrets = { secret: new k8s.core.v1.Secret("s", {}, { provider }), checksum: pulumi.output("x") };

    expect(() => installIngestWorker(wiring as never, cfg, secrets, [])).toThrow(/Invalid ingest sizing/);
  });
});

describe("the budget reaches the pods that spend it", () => {
  it("is emitted from the stack's numbers, under the names the Python modules read", async () => {
    const { cfg } = await load({
      "grid-oib:vlmFleetConcurrency": "40",
      "grid-oib:ingestPageReadParallelism": "5",
      "grid-oib:providerLimitCeiling": "100",
      "grid-oib:providerModelLimitCeiling": "20",
    });
    const { backendEnv, ingestWorkerEnv } = await import("./app/config");
    const wiring = {
      cfg,
      namespace: "grid",
      provider: new k8s.Provider("test-env", { kubeconfig: "apiVersion: v1" }),
      redisUrl: pulumi.output("redis://dragonfly:6379"),
      seaweedInternalEndpoint: pulumi.output("http://seaweedfs:8333"),
      seaweedPublicEndpoint: pulumi.output("https://s3.example.test"),
      dsn: () => pulumi.output("postgresql://x"),
      imagePullSecrets: [],
    };
    const expected = {
      VLM_FLEET_CONCURRENCY: "40",
      INGEST_PAGE_READ_PARALLELISM: "5",
      PROVIDER_LIMIT_CEILING: "100",
      PROVIDER_MODEL_LIMIT_CEILING: "20",
    };

    for (const env of [backendEnv(wiring as never), ingestWorkerEnv(wiring as never, "/tmp/alive")]) {
      const literal = Object.fromEntries(env.map((e) => [e.name, e.value]));
      expect(literal).toMatchObject(expected);
    }

    const sources = [
      read("packages", "knowledge-layer", "src", "llamaindex", "vision_calls.py"),
      read("packages", "knowledge-layer", "src", "llamaindex", "page_reads.py"),
      read("packages", "agent", "src", "agent", "common", "provider_limiter.py"),
    ].join("\n");
    for (const name of Object.keys(expected)) expect(sources, name).toContain(`"${name}"`);
  });

  it("states the numbers the Python modules default to, so the stack file is where they are read", async () => {
    const { cfg } = await load();
    const python = (path: string[], pattern: RegExp) => Number(read(...path).match(pattern)?.[1]);

    expect(cfg.providerLimits.vlmFleetConcurrency).toBe(
      python(["packages", "knowledge-layer", "src", "llamaindex", "vision_calls.py"], /VLM_FLEET_CONCURRENCY = env_int\("VLM_FLEET_CONCURRENCY", (\d+)\)/),
    );
    expect(cfg.providerLimits.pageReadParallelism).toBe(
      python(["packages", "knowledge-layer", "src", "llamaindex", "page_reads.py"], /env_int\("INGEST_PAGE_READ_PARALLELISM", (\d+)/),
    );
    expect(cfg.providerLimits.limitCeiling).toBe(
      python(["packages", "agent", "src", "agent", "common", "provider_limiter.py"], /^_DEFAULT_CEILING = (\d+)$/m),
    );
    expect(cfg.providerLimits.modelLimitCeiling).toBe(
      python(["packages", "agent", "src", "agent", "common", "provider_limiter.py"], /^_DEFAULT_MODEL_CEILING = (\d+)$/m),
    );
  });
});
