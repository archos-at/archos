import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { load } from "js-yaml";
import ts from "typescript";
import { baseStackConfig } from "../test-support/stack-config";
import { WORKFLOW } from "./bff-jobs";
import { hatchetBacklogQuery } from "./keda-scaling";

const repoRoot = join(__dirname, "..", "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), "utf8");

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

function find(type: string, name: string) {
  const hit = RESOURCES.find((r) => r.type === type && r.name === name);
  if (!hit) throw new Error(`no ${type} named "${name}"`);
  return hit;
}

function resolve<T>(value: pulumi.Input<T>): Promise<T> {
  return new Promise((done) => pulumi.output(value).apply((v) => done(v as T)));
}

const DEPLOYMENT = "kubernetes:apps/v1:Deployment";
const SCALED_OBJECT = "kubernetes:keda.sh/v1alpha1:ScaledObject";
const SERVICE = "kubernetes:core/v1:Service";

type ComposeService = {
  extends?: { service: string };
  command: string[];
  ports?: unknown;
  environment?: string[];
};
function composeServices(file: string): Record<string, ComposeService> {
  return (load(read("deploy", "compose", file)) as { services: Record<string, ComposeService> }).services;
}

function backendNames(spec: { rules?: Array<{ backendRefs?: Array<{ name: string }> }> }): string[] {
  return (spec.rules ?? []).flatMap((rule) => (rule.backendRefs ?? []).map((ref) => ref.name));
}

function isProductionSource(file: string): boolean {
  return /\.(ts|js)$/.test(file) && !/\.spec\.ts$/.test(file);
}

function isEnvObject(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return expression.text === "env";
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "env" &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "process"
  );
}

function envNamesIn(node: ts.Node, found: (name: string) => void): void {
  if (ts.isPropertyAccessExpression(node) && isEnvObject(node.expression)) found(node.name.text);
  if (
    ts.isElementAccessExpression(node) &&
    isEnvObject(node.expression) &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    found(node.argumentExpression.text);
  }
  ts.forEachChild(node, (child) => envNamesIn(child, found));
}

function envReads(...dirs: string[]): Map<string, string> {
  const reads = new Map<string, string>();
  for (const dir of dirs) {
    for (const file of readdirSync(dir, { recursive: true }) as string[]) {
      if (!isProductionSource(file)) continue;
      const kind = file.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
      const source = ts.createSourceFile(file, readFileSync(join(dir, file), "utf8"), ts.ScriptTarget.Latest, true, kind);
      envNamesIn(source, (name) => reads.set(name, relative(repoRoot, join(dir, file))));
    }
  }
  return reads;
}

describe("the bff-jobs pool", () => {
  let env: k8s.types.input.core.v1.EnvVar[] = [];
  let drainSeconds = 0;
  let concurrency = 0;
  let langfuseEnabled = false;
  const dsnRequests: Array<{ db: string; clusterWide?: boolean }> = [];

  beforeAll(async () => {
    pulumi.runtime.setAllConfig({
      ...baseStackConfig(),
      "grid-oib:posthogHost": "https://eu.i.posthog.com",
      "grid-oib:posthogProjectToken": "phc_test_token", // pragma: allowlist secret
      "grid-oib:posthogLogsEnabled": "true",
    });
    const { loadConfig } = await import("../config");
    const { installBffJobs } = await import("./bff-jobs");
    const { buildSecrets } = await import("./config");
    const { bffJobsEnv } = await import("./bff-jobs-env");
    const { installNetworkPolicies } = await import("../platform/network-policies");
    const { installHttpRoutes } = await import("./httproutes");
    const cfg = loadConfig();
    drainSeconds = cfg.bffJobs.drainSeconds;
    concurrency = cfg.bffJobs.concurrency;
    langfuseEnabled = cfg.langfuse.enabled;
    const provider = new k8s.Provider("test", { kubeconfig: "apiVersion: v1" });
    const wiring = {
      cfg,
      namespace: "grid",
      provider,
      redisUrl: pulumi.output("redis://dragonfly:6379"),
      seaweedInternalEndpoint: pulumi.output("http://seaweedfs:8333"),
      seaweedPublicEndpoint: pulumi.output("https://s3.example.test"),
      qdrantUrl: pulumi.output("http://qdrant.grid.svc.cluster.local:6333"),
      dsn: (opts: { db: string; clusterWide?: boolean }) => {
        dsnRequests.push({ db: opts.db, clusterWide: opts.clusterWide });
        return pulumi.output(`postgresql://x/${opts.db}`);
      },
      imagePullSecrets: [],
    };
    env = bffJobsEnv(wiring);
    const secrets = buildSecrets(wiring);
    const pool = installBffJobs(wiring, cfg, secrets, []);
    installNetworkPolicies(cfg, provider, "grid");
    const routes = installHttpRoutes(cfg, provider, "grid", []);
    await Promise.all(
      [pool.deployment, ...Object.values(routes)].map((r) => new Promise((done) => r.id.apply(done))),
    );
  });

  it("runs the supervisor, which owns the BFF, in ONE container with no Service in front", async () => {
    const spec = await resolve(find(DEPLOYMENT, "bff-jobs").inputs.spec);
    const pod = spec.template.spec;

    expect(pod.containers).toHaveLength(1);
    expect(pod.containers[0].command).toEqual(["node", "workers/jobs/index.js"]);
    const entry = join(repoRoot, "apps", "workspace", ...pod.containers[0].command.slice(1));
    expect(existsSync(entry), entry).toBe(true);
    expect(pod.securityContext).toMatchObject({ runAsNonRoot: true });
    expect(RESOURCES.filter((r) => r.type === SERVICE && r.name.startsWith("bff-jobs"))).toEqual([]);
  });

  it("is never routed to: no HTTPRoute names it", () => {
    const routes = RESOURCES.filter((r) => r.inputs.kind === "HTTPRoute");
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.flatMap((r) => backendNames(r.inputs.spec))).not.toContain("bff-jobs");
  });

  it("gives a pod its drain budget plus time to stop the BFF it supervises", async () => {
    const spec = await resolve(find(DEPLOYMENT, "bff-jobs").inputs.spec);

    expect(spec.template.spec.terminationGracePeriodSeconds).toBe(drainSeconds + 30);
    expect(spec.strategy.rollingUpdate.maxUnavailable).toBe(0);
    expect(spec.template.spec.containers[0].readinessProbe.httpGet.path).toBe("/api/healthz");
  });

  it("emits only BFF_JOBS_ names the job code reads, and the ones it needs", async () => {
    const readByJobCode = envReads(
      join(repoRoot, "apps", "workspace", "bff", "jobs-queue"),
      join(repoRoot, "apps", "workspace", "workers", "jobs"),
    );
    expect(readByJobCode.has("BFF_JOBS_MAX_ATTEMPTS")).toBe(true);
    const emitted = env.map((e) => e.name as string).filter((name) => /^(GRID_)?BFF_JOBS_/.test(name));

    expect(emitted.length).toBeGreaterThan(2);
    expect(
      emitted.filter((name) => !readByJobCode.has(name)),
      "each BFF_JOBS_ name the pool emits must be read under bff/jobs-queue or workers/jobs",
    ).toEqual([]);
    const names = env.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(["APP_DATABASE_URL", "HATCHET_CLIENT_TOKEN", "HATCHET_CLIENT_HOST_PORT"]));
  });

  it("carries every variable the scheduling tasks read", () => {
    const readBySchedule = envReads(join(repoRoot, "apps", "workspace", "bff", "scheduling"));
    expect(readBySchedule.has("SKILL_RUNS_RETENTION_DAYS")).toBe(true);
    const carried = new Set(env.map((e) => e.name as string));
    const missing = [...readBySchedule]
      .filter(([name]) => !carried.has(name))
      .map(([name, file]) => `${name} (read in ${file})`);
    expect(missing, "the bff-jobs pool must carry every variable the scheduling code reads").toEqual([]);
  });

  it("carries Langfuse's API names and trace retention exactly when Langfuse is deployed", () => {
    const names = env.map((e) => e.name);
    for (const name of ["LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "TRACE_RETENTION_DAYS"]) {
      expect(names.filter((n) => n === name), name).toHaveLength(langfuseEnabled ? 1 : 0);
    }
  });

  it("sets no host mode: the pod runs the Hatchet worker in process, always (ADR-0150)", () => {
    expect(env.find((e) => e.name === "BFF_JOBS_MODE")).toBeUndefined();
  });

  it("carries the Web Push key pair and contact: this pool is the one that sends (ADR-0112)", async () => {
    const names = env.map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "WEB_PUSH_VAPID_PUBLIC_KEY",
        "WEB_PUSH_VAPID_PRIVATE_KEY",
        "WEB_PUSH_SUBJECT",
      ]),
    );
    const privateKey = env.find((e) => e.name === "WEB_PUSH_VAPID_PRIVATE_KEY");
    expect(privateKey).toMatchObject({ valueFrom: { secretKeyRef: { key: "WEB_PUSH_VAPID_PRIVATE_KEY" } } });
  });

  it("names no variable twice, and logs under its own service name", async () => {
    const names = env.map((e) => e.name as string);

    expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
    expect(env.find((e) => e.name === "OTEL_SERVICE_NAME")?.value).toBe("grid-bff-jobs");
    expect(env.find((e) => e.name === "SHUTDOWN_DRAIN_MS")?.value).toBe("5000");
  });

  it("asks KEDA for one replica per `concurrency` open `bff-job` runs, within the configured bounds", async () => {
    const spec = await resolve(find(SCALED_OBJECT, "bff-jobs").inputs.spec);

    expect(spec.triggers).toHaveLength(1);
    expect(spec.triggers[0].type).toBe("postgresql");
    expect(spec.triggers[0].metadata).toMatchObject({
      query: hatchetBacklogQuery("test", WORKFLOW),
      targetQueryValue: String(concurrency),
      activationTargetQueryValue: "0",
    });
    expect(spec.maxReplicaCount).toBeGreaterThanOrEqual(spec.minReplicaCount);
    expect(spec.advanced.horizontalPodAutoscalerConfig.behavior.scaleDown.policies[0]).toMatchObject({
      type: "Pods",
      value: 1,
    });
  });

  it("counts its backlog through the TriggerAuthentication every worker tier shares", async () => {
    const spec = await resolve(find(SCALED_OBJECT, "bff-jobs").inputs.spec);
    expect(WORKFLOW).toBe("bff-job");
    expect(spec.triggers[0].authenticationRef.name).toBe("hatchet-queue-auth");
    expect(RESOURCES.find((r) => r.name === "bff-jobs-queue-auth")).toBeUndefined();
  });

  it("matches the Compose services: same command, nothing published", () => {
    for (const file of ["docker-compose.yaml"]) {
      const services = composeServices(file);
      const svc = services["bff-jobs"];
      expect(svc, file).toBeDefined();
      expect(svc.command, file).toEqual(["node", "workers/jobs/index.js"]);
      expect(svc.ports, file).toBeUndefined();
    }
    const dev = composeServices("docker-compose.yaml");
    expect(dev["bff-jobs"].environment).toEqual(dev.frontend.environment);
  });

  it("sets its knobs per stack: a floor of one in both, a pool in prod", () => {
    const prod = read("deploy", "pulumi", "Pulumi.prod.yaml");
    const dev = read("deploy", "pulumi", "Pulumi.dev.yaml");

    expect(prod).toMatch(/grid-oib:bffJobsMinReplicas: "1"/);
    expect(prod).toMatch(/grid-oib:bffJobsMaxReplicas: "4"/);
    expect(dev).toMatch(/grid-oib:bffJobsMinReplicas: "1"/);
  });

  it("refuses a plan with no replica to run the scheduling crons on", async () => {
    const { assertBffJobsRunsSchedules } = await import("../config/workers");
    expect(() => assertBffJobsRunsSchedules(true, 1)).not.toThrow();
    expect(() => assertBffJobsRunsSchedules(true, 0)).toThrow(/bffJobsMinReplicas must be at least 1.*scheduled automations/);
    expect(() => assertBffJobsRunsSchedules(false, 1)).toThrow(/bffJobsEnabled=false is refused.*maintenance sweeps/);
  });
});
