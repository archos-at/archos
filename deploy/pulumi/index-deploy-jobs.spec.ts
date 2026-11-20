import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig, forProject } from "./src/test-support/stack-config";
import { DependencyGraph } from "./src/test-support/dependency-graph";
import { onlineIndexScript } from "./src/app/online-indexes-job";

const JOB = "kubernetes:batch/v1:Job";
const CRONJOB = "kubernetes:batch/v1:CronJob";
const DEPLOYMENT = "kubernetes:apps/v1:Deployment";

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
      expect(script).toContain("no-table|no-columns|constraint|valid) ;;");
      const env = container.env ?? [];
      expect(env.map((e) => e.name)).toContain("APP_MIGRATION_DATABASE_URL");
      expect(env.find((e) => e.name === "PGOPTIONS")?.value).toMatch(/statement_timeout=0.*lock_timeout=/);
      expect(job("app-online-indexes").spec.backoffLimit).toBeGreaterThan(0);
    });

    it("builds a plain index without UNIQUE, and refuses a name it would have to quote", () => {
      const plain = { migration: "0001", table: "notes", name: "notes_project_idx", columns: ["project_id"], unique: false };
      const script = onlineIndexScript([plain]);
      expect(script).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS "notes_project_idx" ON "public"."notes" ("project_id")');
      expect(script).toContain("indisunique = false");
      expect(() => onlineIndexScript([{ ...plain, name: 'x"; DROP TABLE notes; --' }])).toThrow(/plain lower-case SQL identifier/);
      expect(() => onlineIndexScript([{ ...plain, columns: ["Project"] }])).toThrow(/plain lower-case SQL identifier/);
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
