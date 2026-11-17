import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig, forProject } from "./src/test-support/stack-config";
import { DependencyGraph } from "./src/test-support/dependency-graph";
import { ONLINE_INDEXES } from "./src/app/online-indexes-job";

/**
 * Two steps a release runbook used to ask an operator for, now part of every
 * deploy (docs/deployment/kubernetes.md §3c, "The migration's lock"):
 *
 * - the indexes a migration would build under ACCESS EXCLUSIVE are built
 *   online first, and the migration Job waits for that Job;
 * - one base-corpus sync cycle runs once the api tier rolled out, without the
 *   deploy waiting for it.
 *
 * Nothing here contacts a cluster. It reads what the SDK registers, as the
 * `workspace` project (names.ts), whose names carry no brand.
 */

const JOB = "kubernetes:batch/v1:Job";
const CRONJOB = "kubernetes:batch/v1:CronJob";
const DEPLOYMENT = "kubernetes:apps/v1:Deployment";
const MIGRATIONS = resolve(__dirname, "../../apps/workspace/migrations");

type Container = { image: string; command: string[]; env?: Array<{ name: string; value?: string }> };
type JobInputs = {
  metadata: { annotations?: Record<string, string> };
  spec: {
    backoffLimit: number;
    template: { metadata?: { annotations?: Record<string, string> }; spec: { containers: Container[] } };
  };
};

const RESOURCES: Array<{ type: string; name: string; inputs: Record<string, unknown> }> = [];
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

const job = (name: string): JobInputs => {
  const hit = RESOURCES.find((r) => r.type === JOB && r.name === name);
  expect(hit, `${JOB} ${name}`).toBeDefined();
  return hit!.inputs as unknown as JobInputs;
};

describe("deploy Jobs around the migrations and the rollout", () => {
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

  describe("the online index Job", () => {
    it("runs before the migration Job", () => {
      expect(graph.waitsOn(JOB, "app-migrate", JOB, "app-online-indexes")).toBe(true);
      expect(graph.waitsOn(JOB, "app-online-indexes", JOB, "app-migrate")).toBe(false);
    });

    it("builds each index concurrently and only when absent, with psql, as the migration's owner", () => {
      const container = job("app-online-indexes").spec.template.spec.containers[0];
      expect(container.image).toMatch(/^postgres:\d+/);
      const script = container.command.join(" ");
      expect(script).toContain(
        'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "document_versions_id_project_id_key" ON "public"."document_versions" ("id", "project_id")',
      );
      expect(script).toContain('DROP INDEX CONCURRENTLY IF EXISTS "public"."document_versions_id_project_id_key"');
      // A missing table (a fresh database) and an applied migration are no-ops.
      expect(script).toContain("no-table|no-columns|constraint|valid) ;;");
      const env = container.env ?? [];
      expect(env.map((e) => e.name)).toContain("APP_MIGRATION_DATABASE_URL");
      expect(env.find((e) => e.name === "PGOPTIONS")?.value).toMatch(/statement_timeout=0.*lock_timeout=/);
      expect(job("app-online-indexes").spec.backoffLimit).toBeGreaterThan(0);
    });

    it("names an index the migration it serves adopts by that name", () => {
      // An entry whose name the migration does not use is built for nothing,
      // and the migration then builds its own under the lock.
      for (const ix of ONLINE_INDEXES) {
        const [file] = readdirSync(MIGRATIONS)
          .filter((f) => f.startsWith(`${ix.migration}_`) && f.endsWith(".sql") && !f.endsWith(".down.sql"));
        expect(file, `migration ${ix.migration}`).toBeDefined();
        const sql = readFileSync(resolve(MIGRATIONS, file), "utf8");
        expect(sql).toContain(`USING INDEX "${ix.name}"`);
      }
    });
  });

  describe("the base-corpus sync after the rollout", () => {
    it("is the CronJob's Job, not awaited by the deploy", () => {
      const sync = job("housekeeping-base-corpus-deploy");
      expect(sync.metadata.annotations?.["pulumi.com/skipAwait"]).toBe("true");
      const cron = RESOURCES.find((r) => r.type === CRONJOB && r.name === "housekeeping-base-corpus");
      const cronContainer = (cron?.inputs as { spec: { jobTemplate: { spec: JobInputs["spec"] } } }).spec.jobTemplate
        .spec.template.spec.containers[0];
      const container = sync.spec.template.spec.containers[0];
      expect(container.image).toBe(cronContainer.image);
      expect(container.env).toEqual(cronContainer.env);
    });

    it("runs again whenever the backend image moves", () => {
      expect(job("housekeeping-base-corpus-deploy").spec.template.metadata?.annotations?.["deploy/backend-image"]).toMatch(
        /backend/,
      );
    });

    it("waits for the api tier, which serves the housekeeping route", () => {
      expect(graph.waitsOn(JOB, "housekeeping-base-corpus-deploy", DEPLOYMENT, "api")).toBe(true);
    });
  });
});
