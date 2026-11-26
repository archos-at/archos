import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
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

const repoRoot = join(__dirname, "..", "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), "utf8");

type Service = {
  environment?: string[] | Record<string, unknown>;
  depends_on?: Record<string, unknown> | string[];
  profiles?: string[];
  extends?: { service: string };
};
type Compose = { services: Record<string, Service> };

const COMPOSE_FILES = ["docker-compose.yaml"];
const compose = (file: string) => load(read("deploy", "compose", file)) as Compose;

function env(service: Service): Record<string, string> {
  const raw = service.environment ?? {};
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw.map((item) => item.split(/=(.*)/s).slice(0, 2) as [string, string]));
  }
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, String(value)]));
}

const roleOf = (file: string, name: string) => env(compose(file).services[name]).PROCESS_ROLE;

function effectiveEnv(file: string, name: string): Record<string, string> {
  const service = compose(file).services[name];
  const base = service.extends ? effectiveEnv(file, service.extends.service) : {};
  const raw = service.environment;
  const anchor = raw && !Array.isArray(raw) ? raw["<<"] : undefined;
  const merged = typeof anchor === "object" && anchor !== null ? env({ environment: anchor as Record<string, unknown> }) : {};
  const own = Object.fromEntries(Object.entries(env(service)).filter(([key]) => key !== "<<"));
  return { ...base, ...merged, ...own };
}

const RETIRED = /JOB_EXECUTION|NAT_DASK_SCHEDULER_ADDRESS|NAT_USE_DASK_THREADS|DASK_|MAX_ACTIVE_JOBS(?!_)/;

type Emitted = { owner: string; name: string; value: string | undefined };

function resolve<T>(value: pulumi.Input<T>): Promise<T> {
  return new Promise((done) => pulumi.output(value).apply((v) => done(v as T)));
}

async function emittedEnv(): Promise<Emitted[]> {
  const out: Emitted[] = [];
  for (const r of RESOURCES) {
    const spec = await resolve<any>(r.inputs.spec);
    const pod = spec?.template?.spec ?? spec?.jobTemplate?.spec?.template?.spec;
    const containers: Array<{ name: string; env?: Array<{ name: string; value?: unknown }> }> = [
      ...(pod?.containers ?? []),
      ...(pod?.initContainers ?? []),
    ];
    for (const c of containers) {
      for (const e of c.env ?? []) {
        out.push({ owner: `${r.name}/${c.name}`, name: e.name, value: e.value === undefined ? undefined : String(e.value) });
      }
    }
  }
  return out;
}

describe.each(COMPOSE_FILES)("%s", (file) => {
  it("runs one service per role of the image, each under its own PROCESS_ROLE", () => {
    expect(roleOf(file, "chat")).toBe("chat");
    expect(roleOf(file, "api")).toBe("api");
    expect(roleOf(file, "agent-worker")).toBe("worker");
    expect(roleOf(file, "ingest-worker")).toBe("ingest-worker");
  });

  it("gives the frontend the api service for HTTP and the chat service for the socket", () => {
    const frontend = env(compose(file).services.frontend);

    expect(frontend.BACKEND_URL).toContain("http://api:8000");
    expect(frontend.BACKEND_CHAT_URL).toContain("http://chat:8000");
  });

  it("points every other HTTP consumer of the backend at the api service", () => {
    const consumers = Object.entries(compose(file).services)
      .filter(([name]) => name !== "frontend")
      .map(([name, service]) => [name, env(service).BACKEND_URL] as const)
      .filter(([, url]) => url !== undefined);

    expect(consumers.map(([name]) => name)).toEqual(expect.arrayContaining(["housekeeping", "purger"]));
    for (const [name, url] of consumers) expect(url, name).toContain("http://api:8000");
  });

  it("starts the services that call the api role only after it is up", () => {
    const services = compose(file).services;
    for (const name of ["frontend", "housekeeping", "purger"]) {
      const dependsOn = services[name].depends_on ?? {};
      expect(Object.keys(dependsOn), name).toContain("api");
    }
  });

  it("holds the shared Qdrant ahead of every backend role and points each at it", () => {
    const services = compose(file).services;
    for (const name of ["chat", "api", "agent-worker", "ingest-worker"]) {
      expect(Object.keys(services[name].depends_on ?? {}), name).toContain("qdrant");
      const vars = effectiveEnv(file, name);
      expect(vars.QDRANT_URL, name).toContain("http://qdrant:6333");
      expect(vars.QDRANT_API_KEY, name).toBeDefined();
    }
  });

  it("runs Qdrant by default and no Chroma, nor anything that picks between the two", () => {
    const services = compose(file).services;
    expect(services.qdrant.profiles).toBeUndefined();
    expect(Object.keys(services).filter((name) => /chroma/i.test(name))).toEqual([]);
    for (const name of Object.keys(services)) {
      const retired = Object.keys(effectiveEnv(file, name)).filter(
        (k) => k.startsWith("CHROMA") || k === "VECTOR_BACKEND",
      );
      expect(retired, name).toEqual([]);
    }
  });

  it("gives Qdrant the Pulumi peers' keyless metrics port and write quotas", () => {
    const qdrant = env(compose(file).services.qdrant);
    expect(qdrant.QDRANT__SERVICE__METRICS_PORT).toBe("6336");
    expect(qdrant.QDRANT__STORAGE__QUOTAS__ENABLED).toBe("true");
    expect(qdrant.QDRANT__STORAGE__QUOTAS__MAX_RESIDENT_MEMORY_PERCENT).toBe("${QDRANT_QUOTA_MEMORY_PERCENT:-90}");
    expect(qdrant.QDRANT__STORAGE__QUOTAS__MAX_DISK_USAGE_PERCENT).toBe("${QDRANT_QUOTA_DISK_PERCENT:-85}");
  });

  it("gives Qdrant five minutes to load before its health check counts", () => {
    const check = (compose(file).services.qdrant as { healthcheck?: { start_period?: string } }).healthcheck;
    expect(check?.start_period).toBe("300s");
  });
});

describe("the containers the program emits", () => {
  let emitted: Emitted[] = [];

  beforeAll(async () => {
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), "grid-oib:observabilityEnabled": "false" });
    await import("../../index");
    await new Promise((r) => setTimeout(r, 200));
    emitted = await emittedEnv();
  }, 120_000);

  it("set no PROCESS_ROLE=web and no INGEST_QUEUE_CLAIM", () => {
    expect(new Set(emitted.map((e) => e.owner))).toContain("purger/purger");
    expect(emitted.filter((e) => e.name === "PROCESS_ROLE" && e.value === "web")).toEqual([]);
    expect(emitted.filter((e) => e.name === "INGEST_QUEUE_CLAIM")).toEqual([]);
  });

  it("name no retired execution setting", () => {
    expect(emitted.filter((e) => RETIRED.test(e.name) || RETIRED.test(e.value ?? ""))).toEqual([]);
  });
});

describe("the retired role and claim switch", () => {
  it.each(COMPOSE_FILES)("%s sets no PROCESS_ROLE=web and no INGEST_QUEUE_CLAIM", (file) => {
    for (const name of Object.keys(compose(file).services)) {
      const vars = effectiveEnv(file, name);
      expect(vars.PROCESS_ROLE, name).not.toBe("web");
      expect(Object.keys(vars), name).not.toContain("INGEST_QUEUE_CLAIM");
    }
  });
});

describe("the research queue is the only execution path", () => {
  it.each(COMPOSE_FILES)("%s names no retired execution setting", (file) => {
    const hits = Object.entries(compose(file).services).flatMap(([name]) =>
      Object.entries(effectiveEnv(file, name))
        .filter(([key, value]) => RETIRED.test(key) || RETIRED.test(value))
        .map(([key]) => `${name}/${key}`),
    );
    expect(hits).toEqual([]);
  });
});
