import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as pulumi from "@pulumi/pulumi";
import {
  type PodRequest,
  type Rendered,
  captureResources,
  cpuRequestRender,
  keyedByPathHash,
  pathKey,
  podRequests,
  renderProgram,
  resourceBlocks,
  stackConfig,
} from "./src/test-support/render-stack";

const RESOURCES = captureResources();

async function render(config: Record<string, string>): Promise<Rendered[]> {
  RESOURCES.length = 0;
  pulumi.runtime.setAllConfig(config);
  vi.resetModules();
  await renderProgram(() => import("./index"));
  return [...RESOURCES];
}

const SNAPSHOT = join(__dirname, "src/test-support/prod-cpu-requests.snapshot.json");
const FIX = "wrap the resources in scaledCpuRequest() (or the quantity in cpuRequest()) from src/config/cpu-requests.ts";

const EVERYTHING_ON = {
  "grid-oib:browserRendererEnabled": "true",
  "grid-oib:codeRunnerEnabled": "true",
  "grid-oib:installMetricsServer": "true",
  "grid-oib:cmsEnabled": "true",
  "grid-oib:ingestWorkerHeavyEnabled": "true",
  "grid-oib:seaweedfsBackupEnabled": "true",
  "grid-oib:seaweedfsBackupEndpoint": "https://backup.example.test",
  "grid-oib:seaweedfsBackupAccessKey": "backup",
  "grid-oib:seaweedfsBackupSecretKey": "backup-secret", // pragma: allowlist secret
};
const TOPOLOGIES = ["split", "single"];

// dev's app group, sized in the IPAX console (not in this repo): four 4 vCPU nodes, group `Node`, max 4.
const DEV_APP_NODES = 4;
const DEV_APP_NODE_MILLICORES = 4000;
// Free for unsized pods: IPAX's system pods took about 350m in all (measured 2026-11-18), plus HPA scale-out.
const DEV_APP_RESERVE_MILLICORES = DEV_APP_NODES * 1000;

const blocks = (renders: Rendered[]) =>
  Object.fromEntries(Object.entries(resourceBlocks(renders)).map(([path, block]) => [path.replace(/knowledge-carry-[0-9a-f]+/, "knowledge-carry"), block]));
const allBlocks = (renders: Rendered[][]) => Object.assign({}, ...renders.map(blocks)) as ReturnType<typeof blocks>;

const CPU_TRIGGER_MILLICORES: Record<string, number> = {
  frontend: 350,
  api: 350,
  "aiq-api": 350,
  web: 70,
  "code-runner": 175,
  "browser-renderer": 350,
};

function cpuTriggers(renders: Rendered[]): Record<string, number> {
  const podCpu = (name: string): number => {
    const workload = renders.find(
      (r) => /:apps\/v1:(Deployment|StatefulSet)$/.test(r.type) && (r.inputs.metadata as { name?: string })?.name === name,
    );
    const containers = ((workload?.inputs.spec as any)?.template?.spec?.containers ?? []) as Array<{ resources: { requests: { cpu: string } } }>;
    return containers.reduce((total, c) => total + millicores(c.resources.requests.cpu), 0);
  };
  const triggers: Record<string, number> = {};
  for (const r of renders) {
    const spec = (r.inputs.spec ?? {}) as Record<string, any>;
    const target = spec.scaleTargetRef?.name as string | undefined;
    if (!target) continue;
    const hpa = (spec.metrics ?? []).find((m: any) => m?.resource?.name === "cpu")?.resource?.target?.averageUtilization;
    const keda = (spec.triggers ?? []).find((t: any) => t?.type === "cpu")?.metadata?.value;
    const percent = hpa ?? (keda === undefined ? undefined : Number(keda));
    if (percent !== undefined) triggers[target] = (podCpu(target) * percent) / 100;
  }
  return triggers;
}

const millicores = (q: string): number => (q.endsWith("m") ? Number(q.slice(0, -1)) : Number(q) * 1000);

describe("CPU requests", () => {
  let prod: Rendered[];
  let dev: Rendered[];
  const unscaled: Rendered[][] = [];
  const halved: Rendered[][] = [];

  beforeAll(async () => {
    prod = await render(stackConfig("prod"));
    dev = await render(stackConfig("dev"));
    for (const topology of TOPOLOGIES) {
      const everything = { ...stackConfig("prod"), ...EVERYTHING_ON, "grid-oib:seaweedfsTopology": topology };
      unscaled.push(await render(everything));
      halved.push(await render({ ...everything, "grid-oib:cpuRequestScale": "0.5" }));
    }
  }, 240_000);

  it("render prod's resources and CPU scaling targets as the snapshot pins them", () => {
    const live = cpuRequestRender(prod);
    const keyed = { resources: keyedByPathHash(live.resources), cpuScalingTargets: keyedByPathHash(live.cpuScalingTargets) };
    if (process.env.CPU_REQUESTS_SNAPSHOT === "write") writeFileSync(SNAPSHOT, JSON.stringify(keyed, null, 2) + "\n");
    const snapshot = readFileSync(SNAPSHOT, "utf8");
    const pinned = JSON.parse(snapshot) as typeof keyed;
    const differs = Object.entries({ ...live.resources, ...live.cpuScalingTargets })
      .filter(([path, value]) => JSON.stringify(value) !== JSON.stringify(pinned.resources[pathKey(path)] ?? pinned.cpuScalingTargets[pathKey(path)]))
      .map(([path]) => path);
    expect(differs, "prod renders other resources than the snapshot; for a deliberate prod change: CPU_REQUESTS_SNAPSHOT=write npx vitest run index-cpu-requests.spec.ts").toEqual([]);
    expect(JSON.stringify(keyed, null, 2) + "\n").toBe(snapshot);
  });

  it("are all set through the cpuRequestScale helper", () => {
    const before = allBlocks(unscaled);
    const after = allBlocks(halved);
    const notScaled = Object.entries(before)
      .filter(([path, block]) => {
        const want = Math.max(Math.min(millicores(String(block.requests!.cpu)), 10), Math.ceil(millicores(String(block.requests!.cpu)) / 2));
        return millicores(String(after[path]?.requests?.cpu)) !== want;
      })
      .map(([path]) => `${path}: ${FIX}`);
    expect(notScaled).toEqual([]);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  });

  it("are checked on a render that holds every request dev and prod set", () => {
    const covered = new Set(Object.keys(allBlocks(unscaled)));
    const missing = [...Object.keys(blocks(prod)), ...Object.keys(blocks(dev))].filter((path) => !covered.has(path));
    expect(missing, "switch the feature on in EVERYTHING_ON").toEqual([]);
  });

  it("scale nothing but the CPU request", () => {
    const before = allBlocks(unscaled);
    const after = allBlocks(halved);
    const changed = Object.keys(before).filter(
      (path) =>
        JSON.stringify(before[path].limits) !== JSON.stringify(after[path].limits) ||
        JSON.stringify({ ...before[path].requests, cpu: undefined }) !== JSON.stringify({ ...after[path].requests, cpu: undefined }),
    );
    expect(changed).toEqual([]);
  });

  it("fit dev's app group with room for one surge pod per workload and every deploy Job", () => {
    const appGroup = stackConfig("dev")["grid-oib:nodeGroupApp"];
    const pods: PodRequest[] = podRequests(dev).filter((p) => p.group === appGroup);
    const sum = (list: PodRequest[], each: (p: PodRequest) => number) => list.reduce((total, p) => total + each(p), 0);
    const steady = sum(pods.filter((p) => p.kind === "steady"), (p) => p.replicas * p.millicores);
    const daemons = sum(pods.filter((p) => p.kind === "daemon"), (p) => DEV_APP_NODES * p.millicores);
    const surge = sum(pods.filter((p) => p.kind === "steady"), (p) => p.millicores);
    const jobs = sum(pods.filter((p) => p.kind === "transient"), (p) => p.millicores);
    const capacity = DEV_APP_NODES * DEV_APP_NODE_MILLICORES;
    expect(steady + daemons + surge + jobs, `steady ${steady}m, daemons ${daemons}m, surge ${surge}m, jobs ${jobs}m`).toBeLessThanOrEqual(
      capacity - DEV_APP_RESERVE_MILLICORES,
    );
  });

  it("keep the absolute CPU at which dev's autoscalers scale out", () => {
    const prodTargets = cpuRequestRender(prod).cpuScalingTargets as Record<string, { averageUtilization?: number; value?: string }>;
    const devTargets = cpuRequestRender(dev).cpuScalingTargets as Record<string, { averageUtilization?: number; value?: string }>;
    const scale = Number(stackConfig("dev")["grid-oib:cpuRequestScale"]);
    for (const [path, target] of Object.entries(devTargets)) {
      const percent = target.averageUtilization ?? Number(target.value);
      const base = prodTargets[path] ? (prodTargets[path].averageUtilization ?? Number(prodTargets[path].value)) : 70;
      expect(percent, path).toBe(Math.round(base / scale));
    }
  });

  it("hold every autoscaler's CPU trigger at the same millicores on prod and dev", () => {
    for (const [stack, renders] of [["prod", prod], ["dev", dev]] as const) {
      for (const [name, millis] of Object.entries(cpuTriggers(renders))) {
        expect(Math.abs(millis - CPU_TRIGGER_MILLICORES[name]) / CPU_TRIGGER_MILLICORES[name], `${stack} ${name} scales out at ${millis}m a pod: move its CPU target percentage with its request`).toBeLessThanOrEqual(0.02);
      }
    }
  });
});
