import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig, forProject } from "./src/test-support/stack-config";
import { DependencyGraph } from "./src/test-support/dependency-graph";
import { BACKFILL_SESSION, QDRANT_SEQUENCE, loadBackfills } from "./src/app/backfills";
import { QDRANT_CALLERS } from "./src/platform/network-policies";
import { BACKFILL_POD } from "./src/constants";

const JOB = "kubernetes:batch/v1:Job";
const DEPLOYMENT = "kubernetes:apps/v1:Deployment";
const STATEFULSET = "kubernetes:apps/v1:StatefulSet";
const SERVICE = "kubernetes:core/v1:Service";
const CONFIGMAP = "kubernetes:core/v1:ConfigMap";
const BEFORE = "app-backfill-before";
const AFTER = "app-backfill-after";

type Env = { name: string; value?: string; valueFrom?: unknown };
type Container = { name: string; image: string; command: string[]; env?: Env[] };
type PodSpec = { containers: Container[]; initContainers?: Container[]; restartPolicy?: string };
type Recorded = { type: string; name: string; inputs: Record<string, unknown> };

const RESOURCES: Recorded[] = [];
let graph: DependencyGraph;

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}-id`, state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } } };
    },
    call: () => ({}),
  },
  "workspace",
  "test",
  false,
);

const podOf = (r: Recorded): PodSpec =>
  (r.inputs as { spec: { template: { spec: PodSpec } } }).spec.template.spec;
const job = (name: string) => {
  const hit = RESOURCES.find((r) => r.type === JOB && r.name === name);
  expect(hit, `${JOB} ${name}`).toBeDefined();
  return hit!;
};
const workloads = () => RESOURCES.filter((r) => r.type === DEPLOYMENT || r.type === STATEFULSET);
const containersOf = (r: Recorded) => [...(podOf(r).initContainers ?? []), ...podOf(r).containers];
const readsStoredData = (r: Recorded) =>
  containersOf(r).some((c) =>
    (c.env ?? []).some((e) => /DATABASE_URL$/.test(e.name) || e.name === "QDRANT_URL"),
  );
const runsAppImage = (r: Recorded) =>
  containersOf(r).some((c) => /-(backend|frontend|web):/.test(c.image));

describe("the backfill Jobs around the rollout", () => {
  beforeAll(async () => {
    graph = new DependencyGraph();
    pulumi.runtime.setAllConfig(forProject({ ...baseStackConfig(), "workspace:observabilityEnabled": "false" }, "workspace"));
    const stack = (await import("./index")) as Record<string, unknown>;
    await Promise.all(
      Object.values(stack)
        .filter((v): v is pulumi.Output<unknown> => pulumi.Output.isInstance(v))
        .map((output) => new Promise((resolve) => output.apply(resolve))),
    );
  }, 120_000);

  it("runs the before-readers backfills after the migrations and before every workload that reads stored data", () => {
    expect(graph.waitsOn(JOB, BEFORE, JOB, "app-migrate")).toBe(true);
    expect(graph.waitsOn(JOB, BEFORE, SERVICE, "qdrant")).toBe(true);
    const readers = workloads().filter(readsStoredData);
    expect(readers.length).toBeGreaterThan(5);
    for (const r of readers) {
      expect(graph.waitsOn(r.type, r.name, JOB, BEFORE), `${r.name} waits for ${BEFORE}`).toBe(true);
    }
  });

  it("runs the after-switch backfills only once every app workload has rolled out", () => {
    const app = workloads().filter(runsAppImage);
    expect(app.map((r) => r.name)).toEqual(expect.arrayContaining(["frontend", "api", "chat", "purger", "bff-jobs"]));
    for (const r of app) {
      expect(graph.waitsOn(JOB, AFTER, r.type, r.name), `${AFTER} waits for ${r.name}`).toBe(true);
    }
    expect(graph.waitsOn(JOB, AFTER, JOB, "app-migrate")).toBe(true);
  });

  it("gives each registered backfill one container in its phase's Job, in name order", () => {
    for (const [name, phase] of [[BEFORE, "before-readers"], [AFTER, "after-switch"]] as const) {
      const registered = loadBackfills().filter((b) => b.phase === phase).map((b) => b.name);
      expect(podOf(job(name)).initContainers?.map((c) => c.name)).toEqual(registered);
    }
  });

  it("runs SQL as the database owner the migrate Job uses, never the runtime role", () => {
    const sql = loadBackfills().filter((b) => b.kind === "sql");
    expect(sql.length).toBeGreaterThan(0);
    const migrateEnv = podOf(job("app-migrate")).containers[0].env ?? [];
    for (const b of sql) {
      const container = podOf(job(b.phase === "after-switch" ? AFTER : BEFORE)).initContainers!.find((c) => c.name === b.name)!;
      const urls = (container.env ?? []).filter((e) => /DATABASE_URL$/.test(e.name));
      expect(urls).toEqual(migrateEnv.filter((e) => /DATABASE_URL$/.test(e.name)));
      expect(container.env?.find((e) => e.name === "PGOPTIONS")?.value).toBe(BACKFILL_SESSION);
      expect(container.command.slice(0, 4)).toEqual(["sh", "/backfills/run-sql.sh", b.name, b.phase]);
    }
  });

  it("runs a Qdrant backfill in the backend image: dry run, apply, check", () => {
    for (const b of loadBackfills().filter((x) => x.kind === "qdrant")) {
      const container = podOf(job(b.phase === "after-switch" ? AFTER : BEFORE)).initContainers!.find((c) => c.name === b.name)!;
      expect(container.image).toMatch(/-backend:/);
      expect(container.command).toEqual(["sh", "-c", QDRANT_SEQUENCE, b.name, ...b.command]);
      expect(container.env?.map((e) => e.name)).toEqual(expect.arrayContaining(["QDRANT_URL", "QDRANT_API_KEY"]));
    }
    expect(QDRANT_CALLERS).toContain(BACKFILL_POD);
  });

  it("fails the deploy on a failed backfill and runs again on every image", () => {
    for (const name of [BEFORE, AFTER]) {
      const inputs = job(name).inputs as {
        metadata: { annotations?: Record<string, string> };
        spec: { backoffLimit: number; template: { metadata: { annotations: Record<string, string> } } };
      };
      expect(inputs.metadata.annotations?.["pulumi.com/skipAwait"]).toBeUndefined();
      expect(inputs.spec.backoffLimit).toBeLessThanOrEqual(1);
      expect(podOf(job(name)).restartPolicy).toBe("Never");
      expect(inputs.spec.template.metadata.annotations["deploy/image-tag"]).toBeTruthy();
    }
  });

  it("mounts every SQL file the phase runs", () => {
    const maps = RESOURCES.filter((r) => r.type === CONFIGMAP && r.name.startsWith("app-backfill-after"));
    expect(maps).toHaveLength(1);
    const data = (maps[0].inputs as { data: Record<string, string> }).data;
    for (const b of loadBackfills().filter((x) => x.kind === "sql" && x.phase === "after-switch")) {
      expect(Object.keys(data)).toEqual(expect.arrayContaining([`${b.name}.dry-run.sql`, `${b.name}.apply.sql`]));
    }
    expect(data["run-sql.sh"]).toContain('"event\\":\\"backfill.');
  });
});
