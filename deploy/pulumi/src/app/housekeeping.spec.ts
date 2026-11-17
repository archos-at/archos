import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), "utf8");

const jobsRoutes = read("apps", "agent-host", "src", "agent_host", "routes", "jobs.py");
const workers = read("deploy", "pulumi", "src", "app", "workers.ts");
const composeClock = read("apps", "workspace", "workers", "housekeeping-clock.js");
const appConfig = read("deploy", "pulumi", "src", "app", "config.ts");

const names = (source: string, pattern: RegExp): string[] => [...source.matchAll(pattern)].map((m) => m[1]).sort();

describe("the backend housekeeping CronJobs", () => {
  it("schedule exactly the housekeeping routes the backend registers", () => {
    const registered = names(jobsRoutes, /"\/v1\/maintenance\/housekeeping\/([a-z-]+)"/g);
    const scheduled = names(workers, /route: "([a-z-]+)"/g);
    expect(registered.length).toBe(4);
    expect(scheduled).toEqual(registered);
  });

  it("call the api role, which is the one that registers the routes", () => {
    expect(workers).toContain("`${BACKEND_URL}/v1/maintenance/housekeeping/${route}`");
    expect(appConfig).toContain("export const BACKEND_URL = `http://${API_TIER}:${PORT.backend}`;");
  });

  it("are matched by the Compose clock, which calls the same routes where there are no CronJobs", () => {
    const registered = names(jobsRoutes, /"\/v1\/maintenance\/housekeeping\/([a-z-]+)"/g);
    const clocked = names(composeClock, /route: '([a-z-]+)'/g);
    expect(clocked).toEqual(registered);
  });
});
