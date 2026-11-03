import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as pulumi from "@pulumi/pulumi";
import { HEAVY_POOL, HEAVY_WORKFLOW, WORKFLOW } from "./ingest-worker";
import { hatchetBacklogQuery } from "./keda-scaling";
import { baseStackConfig } from "../test-support/stack-config";

// src/app -> src -> deploy/pulumi -> deploy -> repo root
const repoRoot = join(__dirname, "..", "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), "utf8");

// The program's own resolved config, not a regex over the file next door: the
// default lives in `src/config.ts`, the env wiring in `src/app/config.ts`.
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

/** The program's config with these knobs set (by name, as a stack file sets them). */
async function load(knobs: Record<string, string> = {}) {
  const set = { observabilityEnabled: "false", ...knobs };
  pulumi.runtime.setAllConfig({
    ...baseStackConfig(),
    ...Object.fromEntries(Object.entries(set).map(([key, value]) => [`grid-oib:${key}`, value])),
  });
  return import("../config").then((m) => m.loadConfig());
}

const pythonSources = [
  read("apps", "agent-host", "src", "agent_host", "jobs", "ingest_dispatch.py"),
  read("apps", "agent-host", "src", "agent_host", "jobs", "ingest_worker.py"),
  // The per-organisation cap is read where the in-process pool and the queue share it.
  read("packages", "agent", "src", "agent", "knowledge", "ingest_scheduler.py"),
  // The heavy pool's size threshold and slots, read where the workflows are declared.
  read("packages", "agent", "src", "agent", "knowledge", "ingest_hatchet.py"),
  // The in-process pool's size, read by the knowledge layer's adapter.
  read("packages", "knowledge-layer", "src", "llamaindex", "adapter.py"),
  // One file's page-read pool, OCR and vision together.
  read("packages", "knowledge-layer", "src", "llamaindex", "page_reads.py"),
].join("\n");
const configSource = [
  read("deploy", "pulumi", "src", "app", "config.ts"),
  // The high-memory pool's own env is built beside its Deployment.
  read("deploy", "pulumi", "src", "app", "ingest-worker.ts"),
].join("\n");

const names = (source: string, pattern: RegExp): Set<string> =>
  new Set([...source.matchAll(pattern)].map((m) => m[1]));

/**
 * The ingest tier crosses two process boundaries this program cannot see into:
 * the Python worker reads its env, and KEDA counts the worker's Hatchet workflow.
 * A name that drifts on one side plans and applies clean, and the tier then
 * either never scales or claims nothing. Both sides are read here as source.
 */
describe("the ingest-worker tier", () => {
  it("emits only INGEST_ names the worker reads", () => {
    const readByPython = names(pythonSources, /"(INGEST_[A-Z_]+)"/g);
    const emitted = names(configSource, /name: "(INGEST_[A-Z_]+)"/g);
    expect(emitted.size).toBeGreaterThan(1);
    expect([...emitted].filter((n) => !readByPython.has(n))).toEqual([]);
  });

  it("scales on the backlog of the workflow the worker registers", () => {
    expect(WORKFLOW).toBe("ingest-document");
    expect(hatchetBacklogQuery("prod", WORKFLOW)).toContain("starts_with(action_id, 'prod_ingest-document:')");
    expect(read("deploy", "pulumi", "src", "app", "ingest-worker.ts")).toContain("workflow: WORKFLOW");
  });

  it("runs prod wide and small on the batch group, never able to overcommit a node", async () => {
    // Overcommitted limits took the 16 GB app nodes down one after another
    // (2026-10). The rule that prevents it, not just today's numbers: memory
    // request equals limit, so the scheduler places only what a node holds,
    // and every replica at its limit fits one 64 GB batch node (56 GiB: the
    // node less the kubelet reserve and Gotenberg, which shares the group).
    const prod = read("deploy", "pulumi", "Pulumi.prod.yaml");
    const knob = (key: string) => prod.match(new RegExp(`^\\s*grid-oib:${key}: "?([^"\\s]+)"?\\s*$`, "m"))?.[1];
    const gib = (value: string | undefined) => Number(value?.replace(/Gi$/, ""));

    expect(knob("nodeGroupBatch")).toBe("batch");
    expect(knob("ingestWorkerMaxReplicas")).toBe("7");
    expect(knob("ingestWorkerConcurrency")).toBe("2");
    expect(knob("ingestWorkerRequestsMemory")).toBe(knob("ingestWorkerLimitsMemory"));
    // The high-memory pool shares the group: both pools at their ceilings fit one node.
    const { heavy } = (await load()).ingestWorker;
    expect(heavy.resources.requestsMemory).toBe(heavy.resources.limitsMemory);
    const heavyGib = heavy.maxReplicas * gib(heavy.resources.limitsMemory);
    expect(Number(knob("ingestWorkerMaxReplicas")) * gib(knob("ingestWorkerLimitsMemory")) + heavyGib).toBeLessThanOrEqual(56);
  });

  it("runs heavy files on a high-memory pool that scales on its own workflow's backlog", async () => {
    const { heavy } = (await load()).ingestWorker;
    expect(heavy).toMatchObject({ enabled: true, minReplicas: 0, maxReplicas: 1, concurrency: 1, fileBytes: 41_943_040 });
    expect(heavy.resources.limitsMemory).toBe("12Gi");
    expect(HEAVY_WORKFLOW).toBe("ingest-document-heavy");
    // The standard tier's prefix never counts a heavy run, nor the other way round.
    expect(hatchetBacklogQuery("prod", HEAVY_WORKFLOW)).toContain("'prod_ingest-document-heavy:'");
    expect("prod_ingest-document-heavy:index".startsWith("prod_ingest-document:")).toBe(false);
    // The worker reads the pool, its slots and the label value the Python side requires.
    const python = read("packages", "agent", "src", "agent", "knowledge", "ingest_hatchet.py");
    expect(python).toContain(`HEAVY_WORKFLOW_NAME = "${HEAVY_WORKFLOW}"`);
    expect(python).toContain(`HEAVY_POOL = "${HEAVY_POOL}"`);
    expect(configSource).toContain('{ name: "INGEST_WORKER_POOL", value: "highmem" }');
    expect(read("deploy", "pulumi", "src", "app", "ingest-worker.ts")).toContain("workflow: HEAVY_WORKFLOW");
  });

  it("sends nothing heavy while the stack has no high-memory pool", async () => {
    const cfg = await load({ ingestWorkerHeavyEnabled: "false" });
    const { installIngestWorkerHeavy } = await import("./ingest-worker");
    expect(installIngestWorkerHeavy({} as never, cfg, {} as never, [])).toBeUndefined();
    const { heavyFileBytesEnv } = await import("../config/workers");
    expect(heavyFileBytesEnv(cfg.ingestWorker)).toBe(0);
    expect(configSource).toContain('{ name: "INGEST_HEAVY_FILE_BYTES", value: String(heavyFileBytesEnv(cfg.ingestWorker)) }');
  });

  it("runs the role the entrypoint knows", () => {
    expect(read("apps", "agent-host", "entrypoint.py")).toContain('role == "ingest-worker"');
    expect(configSource).toContain('{ name: "PROCESS_ROLE", value: "ingest-worker" }');
  });

  it("states the raster pixel budget the Python module defaults to", async () => {
    // Two sides, one number: a drift here either refuses a real plan scan or
    // lets one decode grow past the pod's limit. The Python side is read as
    // source, the Pulumi side from the loaded config, like the provider-budget
    // tests' `cfg.providerLimits`.
    const cfg = await load();
    const python = read("packages", "knowledge-layer", "src", "llamaindex", "adapter.py").match(
      /MAX_IMAGE_PIXELS = env_int\("MAX_IMAGE_PIXELS", ([\d_]+)/,
    )?.[1];
    expect(python).toBeDefined();
    expect(cfg.ingestWorker.maxImagePixels).toBe(Number(python!.replace(/_/g, "")));
    expect(configSource).toContain(
      '{ name: "MAX_IMAGE_PIXELS", value: String(w.cfg.ingestWorker.maxImagePixels) }',
    );
  });
});
