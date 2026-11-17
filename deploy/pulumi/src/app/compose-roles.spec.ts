import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

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

describe.each(COMPOSE_FILES)("%s", (file) => {
  it("runs one service per role of the image, each under its own PROCESS_ROLE", () => {
    expect(roleOf(file, "chat")).toBe("chat");
    expect(roleOf(file, "api")).toBe("api");
    expect(roleOf(file, "agent-worker")).toBe("worker");
    expect(roleOf(file, "ingest-worker")).toBe("ingest-worker");
  });

  it("names exactly the roles the entrypoint accepts", () => {
    const roles = Object.values(compose(file).services)
      .map((service) => env(service).PROCESS_ROLE)
      .filter((role): role is string => role !== undefined);
    const accepted = read("apps", "agent-host", "entrypoint.py").match(/^ROLES = \((.*)\)$/m)?.[1];

    expect(accepted).toBeDefined();
    expect(new Set(roles)).toEqual(new Set([...accepted!.matchAll(/"([a-z-]+)"/g)].map((m) => m[1])));
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

describe("the retired role and claim switch", () => {
  const files = [
    ...COMPOSE_FILES.map((f) => join("deploy", "compose", f)),
    join("apps", "agent-host", "entrypoint.py"),
    join("deploy", "pulumi", "src", "app", "config.ts"),
    join("deploy", "pulumi", "src", "app", "api.ts"),
    join("deploy", "pulumi", "src", "app", "backend.ts"),
  ];

  it.each(files)("%s has no PROCESS_ROLE=web and no INGEST_QUEUE_CLAIM", (file) => {
    const source = read(file);

    expect(source).not.toMatch(/PROCESS_ROLE[=:"' ]+web\b/);
    expect(source).not.toContain("INGEST_QUEUE_CLAIM");
  });

  it("is no longer read anywhere under the Python image sources", () => {
    const python = readdirSync(join(repoRoot, "apps", "agent-host", "src", "agent_host"), { recursive: true })
      .filter((f): f is string => typeof f === "string" && f.endsWith(".py"))
      .map((f) => read("apps", "agent-host", "src", "agent_host", f))
      .join("\n");

    expect(python).not.toContain("INGEST_QUEUE_CLAIM");
  });
});

describe("the research queue is the only execution path", () => {
  const retired = /JOB_EXECUTION|NAT_DASK_SCHEDULER_ADDRESS|NAT_USE_DASK_THREADS|DASK_|MAX_ACTIVE_JOBS(?!_)/;
  const files = [
    ...COMPOSE_FILES.map((f) => join("deploy", "compose", f)),
    join("deploy", ".env.example"),
    join("apps", "agent-host", "entrypoint.py"),
    join("deploy", "pulumi", "src", "config.ts"),
    ...readdirSync(join(repoRoot, "deploy", "pulumi", "src", "config"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => join("deploy", "pulumi", "src", "config", f)),
    join("deploy", "pulumi", "src", "app", "config.ts"),
    join("deploy", "pulumi", "src", "app", "api.ts"),
    join("deploy", "pulumi", "src", "app", "backend.ts"),
  ];

  it.each(files)("%s names no retired execution setting", (file) => {
    expect(read(file)).not.toMatch(retired);
  });

  it("the Python sources read none of them either", () => {
    const python = [join("apps", "agent-host", "src", "agent_host"), join("packages", "agent", "src", "agent")]
      .flatMap((dir) =>
        readdirSync(join(repoRoot, dir), { recursive: true })
          .filter((f): f is string => typeof f === "string" && f.endsWith(".py"))
          .map((f) => read(dir, f)),
      )
      .join("\n");

    expect(python).not.toMatch(retired);
  });
});
