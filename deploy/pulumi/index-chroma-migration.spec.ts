import { describe, it, expect, beforeAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "./src/test-support/stack-config";
import { DependencyGraph } from "./src/test-support/dependency-graph";

const EXPORTER = "# chroma_export.py under test\n";
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((path: unknown, ...rest: unknown[]) =>
    String(path).endsWith("/deploy/migration/chroma_export.py")
      ? EXPORTER
      : (fs.readFileSync as (...a: unknown[]) => unknown)(path, ...rest)) as typeof fs.readFileSync;
  return { ...fs, readFileSync, default: { ...fs, readFileSync } };
});

type Env = { name: string; value?: string; valueFrom?: { secretKeyRef?: { name: string; key: string } } };
type Mount = { name: string; mountPath: string; readOnly?: boolean };
type Container = {
  name: string;
  image: string;
  command: string[];
  env?: Env[];
  volumeMounts?: Mount[];
  securityContext?: Record<string, unknown>;
  resources?: { requests: Record<string, string>; limits: Record<string, string> };
};
type PodSpec = {
  restartPolicy: string;
  enableServiceLinks: boolean;
  securityContext: Record<string, unknown>;
  volumes: unknown[];
  initContainers: Container[];
  containers: Container[];
};
type JobInputs = {
  metadata: { name: string; annotations?: Record<string, string> };
  spec: { backoffLimit: number; ttlSecondsAfterFinished?: number; template: { spec: PodSpec } };
};
type PolicyPeer = { podSelector: { matchLabels: Record<string, string> } };

const RESOURCES: Array<{ type: string; name: string; id?: string; inputs: Record<string, unknown> }> = [];
let graph: DependencyGraph;

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, id: args.id, inputs: args.inputs });
      return {
        id: args.id ?? `${args.name}-id`,
        state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } },
      };
    },
    call: () => ({}),
  },
  "grid-oib",
  "test",
  false,
);

const JOB = "kubernetes:batch/v1:Job";
const find = (type: string, name: string) => {
  const hit = RESOURCES.find((r) => r.type === type && r.name === name);
  expect(hit, `${type} ${name}`).toBeDefined();
  return hit!;
};
const job = () => find(JOB, "chroma-migration").inputs as unknown as JobInputs;
const pod = () => job().spec.template.spec;
const step = (name: string): Container =>
  [...pod().initContainers, ...pod().containers].find((c) => c.name === name) as Container;
const envOf = (c: Container) => Object.fromEntries((c.env ?? []).map((e) => [e.name, e]));

describe("the Chroma migration Job, switched on", () => {
  beforeAll(async () => {
    graph = new DependencyGraph();
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), "grid-oib:chromaMigration": "true" });
    const stack = (await import("./index")) as Record<string, unknown>;
    await Promise.all(
      Object.values(stack)
        .filter((v): v is pulumi.Output<unknown> => pulumi.Output.isInstance(v))
        .map((output) => new Promise((resolve) => output.apply(resolve))),
    );
  }, 120_000);

  it("ships the exporter from deploy/migration in a ConfigMap", () => {
    const cm = find("kubernetes:core/v1:ConfigMap", "chroma-migration-exporter").inputs as {
      data: Record<string, string>;
    };
    expect(cm.data).toEqual({ "chroma_export.py": EXPORTER });
  });

  it("never mounts, reads or manages the old Chroma claim", () => {
    expect(RESOURCES.filter((r) => r.type === "kubernetes:core/v1:PersistentVolumeClaim")).toEqual([]);
    const claims = pod().volumes.filter((v) => (v as { persistentVolumeClaim?: unknown }).persistentVolumeClaim);
    expect(claims).toEqual([]);
    expect((pod() as PodSpec & { affinity?: unknown }).affinity).toBeUndefined();
  });

  it("reaches the Chroma server through the same-namespace allow", () => {
    const intra = find("kubernetes:networking.k8s.io/v1:NetworkPolicy", "allow-same-namespace").inputs as {
      spec: { podSelector: { matchExpressions: Array<{ key: string; operator: string; values: string[] }> } };
    };
    const [withheld] = intra.spec.podSelector.matchExpressions;
    expect(withheld).toMatchObject({ key: "app.kubernetes.io/name", operator: "NotIn" });
    expect(withheld.values).not.toContain("chroma");
  });

  it("shares a scratch claim on the stack's StorageClass, sized by the knob, not the node's disk", () => {
    expect(pod().volumes).toContainEqual({
      name: "exchange",
      ephemeral: {
        volumeClaimTemplate: {
          metadata: { labels: expect.objectContaining({ "app.kubernetes.io/name": "chroma-migration" }) },
          spec: {
            accessModes: ["ReadWriteOnce"],
            storageClassName: "premium",
            resources: { requests: { storage: "50Gi" } },
          },
        },
      },
    });
    for (const c of [...pod().initContainers, ...pod().containers]) {
      expect(c.volumeMounts, c.name).toContainEqual({ name: "exchange", mountPath: "/exchange" });
    }
  });

  it("exports first, from the running Chroma Service, through uv so the chromadb the script pins is installed", () => {
    expect(pod().initContainers.map((c) => c.name)).toEqual(["export"]);
    const exporter = step("export");
    expect(exporter.image).toBe("ghcr.io/astral-sh/uv:0.11.32-python3.12-trixie-slim");
    expect(exporter.command.slice(0, 2)).toEqual(["sh", "-c"]);
    expect(exporter.command[2].split("\n").at(-1)).toBe(
      "exec uv run --script /migration/chroma_export.py --url http://chroma:8000 --out /exchange/export",
    );
    expect(exporter.volumeMounts).toContainEqual({ name: "migration", mountPath: "/migration", readOnly: true });
    const env = envOf(exporter);
    expect(env.UV_CACHE_DIR.value).toBe("/exchange/uv-cache");
    expect(env.TMPDIR.value).toBe("/exchange/tmp");
    expect(env.HOME.value).toBe("/exchange/home");
    expect(env.UV_PYTHON_DOWNLOADS.value).toBe("never");
  });

  it("imports in the backend image with the backend's Qdrant URL and key, and verifies", () => {
    expect(pod().containers.map((c) => c.name)).toEqual(["import"]);
    const importer = step("import");
    expect(importer.image).toMatch(/aiq-agent|backend/);
    expect(importer.command).toEqual(["python", "scripts/import_vectors.py", "--in", "/exchange/export", "--verify"]);
    const env = envOf(importer);
    expect(env.QDRANT_URL.value).toBe("http://qdrant.grid.svc.cluster.local:6333");
    expect(env.QDRANT_API_KEY.valueFrom!.secretKeyRef).toEqual({ name: "grid-secrets", key: "QDRANT_API_KEY" });
  });

  it("runs as a non-root user with no privilege, on read-only roots where the image allows", () => {
    expect(pod().securityContext).toEqual({
      runAsNonRoot: true,
      runAsUser: 1000,
      runAsGroup: 1000,
      fsGroup: 1000,
      fsGroupChangePolicy: "OnRootMismatch",
    });
    expect(pod().enableServiceLinks).toBe(false);
    for (const c of [...pod().initContainers, ...pod().containers]) {
      expect(c.securityContext, c.name).toMatchObject({
        allowPrivilegeEscalation: false,
        privileged: false,
        capabilities: { drop: ["ALL"] },
        seccompProfile: { type: "RuntimeDefault" },
      });
      expect(c.resources?.limits.memory, c.name).toBeDefined();
    }
    expect(step("export").securityContext).toMatchObject({ readOnlyRootFilesystem: true });
  });

  it("runs once: a later deploy never replaces it", () => {
    expect(graph.find(JOB, "chroma-migration").ignoreChanges).toEqual(["spec"]);
  });

  it("never retries, so a failed pod keeps its log and the export for inspection", () => {
    expect(pod().restartPolicy).toBe("Never");
    expect(job().spec.backoffLimit).toBe(0);
  });

  it("stays until the flag is switched off: no TTL a refresh could turn into a second import", () => {
    expect(job().spec).not.toHaveProperty("ttlSecondsAfterFinished");
  });

  it("is awaited by the deploy, for at most 40 minutes", () => {
    expect(job().metadata.annotations?.["pulumi.com/skipAwait"]).toBeUndefined();
    expect(graph.find(JOB, "chroma-migration").customTimeouts).toMatchObject({ create: "40m", update: "40m" });
  });

  it("starts once Qdrant is up and the metadata store is reachable", () => {
    for (const [type, name] of [
      ["kubernetes:apps/v1:StatefulSet", "qdrant"],
      ["kubernetes:core/v1:Service", "qdrant"],
      ["kubernetes:core/v1:ConfigMap", "chroma-migration-exporter"],
      ["kubernetes:core/v1:Secret", "grid-secrets"],
    ]) {
      expect(graph.waitsOn(JOB, "chroma-migration", type, name), name).toBe(true);
    }
  });

  it("rolls every tier that reads or writes Qdrant only after the Job, and waits on none of them", () => {
    const tiers: Array<[string, string]> = [
      ["kubernetes:apps/v1:Deployment", "aiq-api"],
      ["kubernetes:apps/v1:StatefulSet", "aiq-agent"],
      ["kubernetes:apps/v1:Deployment", "agent-worker"],
      ["kubernetes:apps/v1:Deployment", "ingest-worker"],
      ["kubernetes:apps/v1:Deployment", "frontend"],
    ];
    for (const [type, name] of tiers) {
      expect(graph.waitsOn(type, name, JOB, "chroma-migration"), `${name} after the Job`).toBe(true);
      expect(graph.waitsOn(JOB, "chroma-migration", type, name), `the Job not after ${name}`).toBe(false);
    }
  });

  it("suspends the base-corpus sync and the vector reconcile, and only those, before the export starts", () => {
    const CRON = "kubernetes:batch/v1:CronJob";
    const suspended = RESOURCES.filter(
      (r) => r.type === CRON && (r.inputs as { spec: { suspend?: boolean } }).spec.suspend === true,
    );
    expect(suspended.map((r) => r.name).sort()).toEqual(["housekeeping-base-corpus", "vector-reconcile"]);
    for (const name of ["housekeeping-base-corpus", "vector-reconcile"]) {
      expect(graph.waitsOn(JOB, "chroma-migration", CRON, name), name).toBe(true);
    }
  });

  it("is a named caller of Qdrant's client ports", () => {
    const policy = find("kubernetes:networking.k8s.io/v1:NetworkPolicy", "allow-app-to-qdrant").inputs as {
      spec: { ingress: Array<{ from: PolicyPeer[] }> };
    };
    const callers = policy.spec.ingress[0].from.map((f) => f.podSelector.matchLabels["app.kubernetes.io/name"]);
    expect(callers).toContain("chroma-migration");
  });
});
