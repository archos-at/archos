import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { load } from "js-yaml";
import { baseStackConfig } from "../test-support/stack-config";
import { WORKFLOW } from "./bff-jobs";
import { hatchetBacklogQuery } from "./keda-scaling";

// src/app -> src -> deploy/pulumi -> deploy -> repo root
const repoRoot = join(__dirname, "..", "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), "utf8");

/**
 * The BFF's background pool (ADR-0079).
 *
 * It crosses three boundaries this program cannot see into, and each one plans
 * and applies clean when it drifts:
 *   - the runner reads its env (`apps/workspace/workers/jobs/index.js`), and a
 *     renamed knob leaves the pool on its defaults;
 *   - KEDA counts the queue's table, and a table or status that moves leaves
 *     the pool at its floor with work waiting (or up forever for dead rows);
 *   - nothing may route to the pod: its internal route runs a job's work as
 *     whoever the queue row names, and its only legitimate caller is the loop
 *     on its own loopback.
 */

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

type ComposeService = {
  extends?: { service: string };
  command: string[];
  ports?: unknown;
  environment?: string[];
};
function composeServices(file: string): Record<string, ComposeService> {
  return (load(read("deploy", "compose", file)) as { services: Record<string, ComposeService> }).services;
}

describe("the bff-jobs pool", () => {
  let env: k8s.types.input.core.v1.EnvVar[] = [];
  let drainSeconds = 0;
  let concurrency = 0;
  const dsnRequests: Array<{ db: string; clusterWide?: boolean }> = [];

  beforeAll(async () => {
    pulumi.runtime.setAllConfig({
      ...baseStackConfig(),
      // The pool logs under its own name only where the collector runs, and the
      // collector counts as deployed once something consumes it: PostHog logs here.
      "grid-oib:posthogHost": "https://eu.i.posthog.com",
      "grid-oib:posthogProjectToken": "phc_test_token", // pragma: allowlist secret
      "grid-oib:posthogLogsEnabled": "true",
    });
    const { loadConfig } = await import("../config");
    const { installBffJobs } = await import("./bff-jobs");
    const { buildSecrets } = await import("./config");
    const { bffJobsEnv } = await import("./bff-jobs-env");
    const { installNetworkPolicies } = await import("../platform/network-policies");
    const cfg = loadConfig();
    drainSeconds = cfg.bffJobs.drainSeconds;
    concurrency = cfg.bffJobs.concurrency;
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
    await new Promise((done) => pool.deployment.id.apply(done));
  });

  it("runs the supervisor, which owns the BFF, in ONE container with no Service in front", async () => {
    const spec = await resolve(find(DEPLOYMENT, "bff-jobs").inputs.spec);
    const pod = spec.template.spec;

    expect(pod.containers).toHaveLength(1);
    expect(pod.containers[0].command).toEqual(["node", "workers/jobs/index.js"]);
    // A path that moves leaves a pod that crash-loops with a green plan.
    expect(existsSync(join(repoRoot, "apps", "workspace", "workers", "jobs", "index.js"))).toBe(true);
    // The image copies `workers/` whole; a second COPY line per file is how
    // `purger/` once shipped without a module it required.
    expect(read("apps", "workspace", "deploy", "Dockerfile")).toMatch(/COPY .*\/app\/workers \.\/workers/);
    expect(pod.securityContext).toMatchObject({ runAsNonRoot: true });
    expect(RESOURCES.filter((r) => r.type === "kubernetes:core/v1:Service" && r.name === "bff-jobs")).toEqual([]);
  });

  it("is never routed to: no HTTPRoute names it", () => {
    expect(read("deploy", "pulumi", "src", "app", "httproutes.ts")).not.toMatch(/bff-jobs/);
    // And this module creates no Service: the runner reaches the BFF on loopback.
    expect(read("deploy", "pulumi", "src", "app", "bff-jobs.ts")).not.toMatch(/core\.v1\.Service/);
  });

  it("gives a pod its drain budget plus time to stop the BFF it supervises", async () => {
    const spec = await resolve(find(DEPLOYMENT, "bff-jobs").inputs.spec);

    // The runner drains for `drainSeconds`, then stops the BFF: SIGKILL before
    // that would cost every claim in hand its stale window and an attempt.
    expect(spec.template.spec.terminationGracePeriodSeconds).toBe(drainSeconds + 30);
    expect(spec.strategy.rollingUpdate.maxUnavailable).toBe(0);
    expect(spec.template.spec.containers[0].readinessProbe.httpGet.path).toBe("/api/healthz");
  });

  it("emits only BFF_JOBS_ names the runner reads, and the ones it needs", async () => {
    const readByRunner = new Set(
      [...read("apps", "workspace", "workers", "jobs", "index.js").matchAll(/\b((?:GRID_)?BFF_JOBS_[A-Z_]+)/g)].map((m) => m[1]),
    );
    const emitted = env.map((e) => e.name as string).filter((name) => /^(GRID_)?BFF_JOBS_/.test(name));

    expect(emitted.length).toBeGreaterThan(2);
    expect(emitted.filter((name) => !readByRunner.has(name))).toEqual([]);
    // What the worker and the services in its pod cannot start without.
    const names = env.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(["APP_DATABASE_URL", "HATCHET_CLIENT_TOKEN", "HATCHET_CLIENT_HOST_PORT"]));
  });

  it("carries what the scheduling tasks read: run retention, and Langfuse's API for the trace sweeps", () => {
    // The names `bff/scheduling/sweeps.ts` reads, and the shared trace client's window.
    const sweeps = read("apps", "workspace", "bff", "scheduling", "sweeps.ts") + read("apps", "workspace", "workers", "langfuse-traces.js")
    for (const name of ["SKILL_RUNS_RETENTION_DAYS", "TRACE_RETENTION_DAYS", "LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"]) {
      expect(sweeps).toContain(name);
    }
    const names = env.map((e) => e.name);
    expect(names).toContain("SKILL_RUNS_RETENTION_DAYS");
    // Once each: the frontend's Langfuse settings are withheld and the API keys added back on their own.
    expect(names.filter((name) => name === "LANGFUSE_HOST")).toHaveLength(names.includes("TRACE_RETENTION_DAYS") ? 1 : 0);
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
    // Stopped after the runner has drained, so it needs no long WebSocket drain.
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
    // In slowly and a pod at a time: each one drains for up to its budget.
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
    for (const file of ["docker-compose.yaml", "docker-compose.coolify.yaml"]) {
      const services = composeServices(file);
      const svc = services["bff-jobs"];
      expect(svc, file).toBeDefined();
      expect(svc.command, file).toEqual(["node", "workers/jobs/index.js"]);
      // Internal only: a published port would put the pod's BFF on the host.
      expect(svc.ports, file).toBeUndefined();
    }
    // The dev file shares the frontend's environment by alias, so the two
    // cannot disagree; the Coolify one inherits it. Either way it is the
    // frontend's, in full, because a job calls the same services a route does.
    const dev = composeServices("docker-compose.yaml");
    expect(dev["bff-jobs"].environment).toEqual(dev.frontend.environment);
    expect(composeServices("docker-compose.coolify.yaml")["bff-jobs"].extends).toEqual({ service: "frontend" });
  });

  it("sets its knobs per stack: a floor of one in both, a pool in prod", () => {
    const prod = read("deploy", "pulumi", "Pulumi.prod.yaml");
    const dev = read("deploy", "pulumi", "Pulumi.dev.yaml");

    expect(prod).toMatch(/grid-oib:bffJobsMinReplicas: "1"/);
    expect(prod).toMatch(/grid-oib:bffJobsMaxReplicas: "4"/);
    expect(dev).toMatch(/grid-oib:bffJobsMinReplicas: "1"/);
  });

  it("refuses a plan with no replica to run the scheduling crons on", async () => {
    // KEDA wakes the pool for `bff-job` runs only; a cron adds nothing to that
    // backlog, so at zero replicas no automation fires and no sweep prunes.
    const { assertBffJobsRunsSchedules } = await import("../config/workers");
    expect(() => assertBffJobsRunsSchedules(true, 1)).not.toThrow();
    expect(() => assertBffJobsRunsSchedules(true, 0)).toThrow(/bffJobsMinReplicas must be at least 1.*scheduled automations/);
    expect(() => assertBffJobsRunsSchedules(false, 1)).toThrow(/bffJobsEnabled=false is refused.*maintenance sweeps/);
  });
});
