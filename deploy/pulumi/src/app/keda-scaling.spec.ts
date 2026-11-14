import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "../test-support/stack-config";
import { fallbackReplicas, hatchetBacklogQuery } from "./keda-scaling";

/**
 * KEDA across every ScaledObject (ADR-0079, phase 3).
 *
 * Four tiers are scaled by it (`ingest-worker`, `agent-worker`, `bff-jobs` on
 * their queues, `aiq-agent` on running turns). What goes wrong here plans clean
 * and deploys green, and shows up as a tier that does not scale and an alert
 * that says nothing:
 *   - a trigger that cannot be read and no `fallback`, so the tier sits at
 *     whatever count it had while its queue grows;
 *   - a scaler credential that is the schema owner's, held by an operator in
 *     another namespace;
 *   - a scaler that counts a Hatchet workflow under another name than the
 *     workers register, so the tier never leaves its floor;
 *   - a grace period shorter than the drain, so the release-on-drain path never
 *     runs before SIGKILL;
 *   - a chart nobody pinned, validated against CRDs of another release.
 */

type Resource = { type: string; name: string; inputs: Record<string, any> };
const RESOURCES: Resource[] = [];

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

// src/app -> src -> deploy/pulumi -> deploy -> repo root
const repoRoot = join(__dirname, "..", "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), "utf8");

function find(type: string, name: string): Resource {
  const hit = RESOURCES.find((r) => r.type === type && r.name === name);
  if (!hit) throw new Error(`no ${type} named "${name}"`);
  return hit;
}

function resolve<T>(value: pulumi.Input<T>): Promise<T> {
  return new Promise((done) => pulumi.output(value).apply((v) => done(v as T)));
}

const SCALED = "kubernetes:keda.sh/v1alpha1:ScaledObject";
const AUTH = "kubernetes:keda.sh/v1alpha1:TriggerAuthentication";
const DEPLOYMENT = "kubernetes:apps/v1:Deployment";
const SECRET = "kubernetes:core/v1:Secret"; // pragma: allowlist secret (a Pulumi resource type)
const NETPOL = "kubernetes:networking.k8s.io/v1:NetworkPolicy";
const RELEASE = "kubernetes:helm.sh/v3:Release";
const CLUSTER = "kubernetes:postgresql.cnpg.io/v1:Cluster";

const QUEUE_TIERS = ["ingest-worker", "agent-worker", "bff-jobs"];
const ALL_TIERS = [...QUEUE_TIERS, "chat"];

const STACK = {
  "grid-oib:allowPlaintextJobPayloads": "true",
  "grid-oib:chatAffinity": "false",
  "grid-oib:backendReplicas": "1",
  "grid-oib:backendMaxReplicas": "3",
  "grid-oib:observabilityEnabled": "false",
};

let cfg: Awaited<ReturnType<typeof import("../config")["loadConfig"]>>;
const dsnRequests: Array<Record<string, any>> = [];
let scalerPassword = "";

// A Secret's `stringData` is wrapped whole when any value in it is secret.
const SECRET_SIGNATURE = "4dabf18193072939515e22adb298388d"; // pragma: allowlist secret (Pulumi's public secret marker)
async function stringData(name: string): Promise<Record<string, string>> {
  const data = await resolve(find(SECRET, name).inputs.stringData as Record<string, any>);
  return data[SECRET_SIGNATURE] ? data.value : data;
}

async function scaled(name: string): Promise<Record<string, any>> {
  return resolve(find(SCALED, name).inputs.spec);
}

describe("the program's ScaledObjects", () => {
  beforeAll(async () => {
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), ...STACK });
    const { loadConfig } = await import("../config");
    const { installKeda } = await import("../platform/keda");
    const { installNetworkPolicies } = await import("../platform/network-policies");
    const { installPostgres } = await import("../data/postgres");
    const { buildSecrets } = await import("./config");
    const { installHatchetQueueAuth } = await import("./hatchet-queue-auth");
    const { installBackgroundWorkPostgres } = await import("../data/background-work-pg");
    const { installHatchetNetworkPolicies } = await import("../platform/hatchet-network-policies");
    const { installIngestWorker } = await import("./ingest-worker");
    const { installAgentWorker } = await import("./agent-worker");
    const { installBffJobs } = await import("./bff-jobs");
    const { installBackend } = await import("./backend");
    const { installBackendScaling } = await import("./backend-scaling");

    cfg = loadConfig();
    scalerPassword = await resolve(cfg.postgres.scalerPassword);
    const provider = new k8s.Provider("test", { kubeconfig: "apiVersion: v1" });
    const wiring = {
      cfg,
      namespace: "grid",
      provider,
      redisUrl: pulumi.output("redis://dragonfly:6379"),
      seaweedInternalEndpoint: pulumi.output("http://seaweedfs:8333"),
      seaweedPublicEndpoint: pulumi.output("https://s3.example.test"),
      qdrantUrl: pulumi.output("http://qdrant.grid.svc.cluster.local:6333"),
      dsn: (opts: Record<string, any>) => {
        dsnRequests.push(opts);
        return pulumi.output(`postgresql://x/${opts.db}`);
      },
      imagePullSecrets: [],
    };

    installKeda(provider);
    installPostgres(cfg, provider, "grid");
    const secrets = buildSecrets(wiring as never);
    const bgPg = installBackgroundWorkPostgres(cfg, provider, []);
    const grants = bgPg.grants([]);
    installHatchetQueueAuth(wiring as never, bgPg.scalerDsn, [grants]);
    installHatchetNetworkPolicies(cfg, provider, "grid", []);
    const ingest = installIngestWorker(wiring as never, cfg, secrets, [grants]);
    const agent = installAgentWorker(wiring as never, cfg, secrets, [grants]);
    const bff = installBffJobs(wiring as never, cfg, secrets, [grants]);
    const backend = installBackend(wiring as never, cfg, secrets, []);
    const chat = installBackendScaling(wiring as never, cfg, backend.statefulSet, []);
    installNetworkPolicies(cfg, provider, "grid");
    // Pulumi registers resources asynchronously: wait for each one the tests read.
    const registered = [ingest, agent, bff].flatMap((t) => [t.deployment, t.scaledObject]);
    for (const r of [...registered, chat.scaledObject, chat.auth, backend.service, grants]) {
      await new Promise((done) => r.id.apply(done));
    }
  }, 60_000);

  it("are four, and poll their triggers at one interval", async () => {
    expect(RESOURCES.filter((r) => r.type === SCALED).map((r) => r.name).sort()).toEqual([...ALL_TIERS].sort());
    for (const tier of ALL_TIERS) expect((await scaled(tier)).pollingInterval, tier).toBe(15);
  });

  describe("fallback", () => {
    it("holds every ScaledObject that can have one to the same rule: three failed polls, then a count of its own", async () => {
      for (const tier of QUEUE_TIERS) {
        const spec = await scaled(tier);
        expect(spec.fallback, tier).toMatchObject({ failureThreshold: 3, behavior: "currentReplicasIfHigher" });
        expect(spec.fallback.replicas, tier).toBeGreaterThanOrEqual(Math.max(1, spec.minReplicaCount));
        expect(spec.fallback.replicas, tier).toBeLessThanOrEqual(spec.maxReplicaCount);
      }
    });

    it("leaves it off only where a cpu trigger forbids it, which is the chat tier alone", async () => {
      // KEDA refuses `fallback` beside a cpu trigger. The rule is stated as a
      // property, not a list, so a fifth tier cannot quietly be the exception.
      const withoutFallback: string[] = [];
      for (const r of RESOURCES.filter((x) => x.type === SCALED)) {
        const spec = await resolve(r.inputs.spec as Record<string, any>);
        const hasCpu = spec.triggers.some((t: { type: string }) => t.type === "cpu");
        if (spec.fallback === undefined) withoutFallback.push(r.name);
        if (hasCpu) expect(spec, r.name).not.toHaveProperty("fallback");
        else expect(spec, r.name).toHaveProperty("fallback");
      }
      expect(withoutFallback).toEqual(["chat"]);
    });

    it("sizes the blind count from the tier's own floor and ceiling", () => {
      // A third of the ceiling, at least one pod and the floor, never above the ceiling.
      expect(fallbackReplicas(0, 3)).toBe(1);
      expect(fallbackReplicas(1, 8)).toBe(3);
      expect(fallbackReplicas(0, 20)).toBe(7);
      expect(fallbackReplicas(5, 6)).toBe(5);
      expect(fallbackReplicas(1, 1)).toBe(1);
      expect(fallbackReplicas(4, 2)).toBe(2);
    });
  });

  describe("the queue tiers, which differ only in what they count", () => {
    it("poll, cool down and scale on one policy", async () => {
      const [first, ...rest] = await Promise.all(QUEUE_TIERS.map(scaled));
      for (const spec of rest) {
        expect(spec.pollingInterval).toBe(first.pollingInterval);
        expect(spec.cooldownPeriod).toBe(first.cooldownPeriod);
        // The policy, not the HPA's name: a tier that adopts a pre-KEDA HPA names it.
        expect(spec.advanced.horizontalPodAutoscalerConfig.behavior).toEqual(
          first.advanced.horizontalPodAutoscalerConfig.behavior,
        );
      }
      expect(first.pollingInterval).toBe(15);
      const behavior = first.advanced.horizontalPodAutoscalerConfig.behavior;
      expect(behavior.scaleUp.stabilizationWindowSeconds).toBe(0);
      // A pod at a time on the way in: each one drains for up to its budget.
      expect(behavior.scaleDown.policies).toEqual([{ type: "Pods", value: 1, periodSeconds: 60 }]);
    });

    it("count their own Hatchet workflow's backlog and ask for one replica per `concurrency` runs", async () => {
      const workflows: Record<string, [string, number]> = {
        "ingest-worker": ["ingest-document", cfg.ingestWorker.concurrency],
        "agent-worker": ["research-run", cfg.agentWorker.concurrency],
        "bff-jobs": ["bff-job", cfg.bffJobs.concurrency],
      };
      for (const [tier, [workflow, concurrency]] of Object.entries(workflows)) {
        const triggers = (await scaled(tier)).triggers;
        // Hatchet only: the claim-queue depth trigger is gone with the queues.
        expect(triggers, tier).toHaveLength(1);
        const [trigger] = triggers;
        expect(trigger.type, tier).toBe("postgresql");
        expect(trigger.metricType, tier).toBe("AverageValue");
        expect(trigger.authenticationRef, tier).toEqual({ name: "hatchet-queue-auth" });
        expect(trigger.metadata, tier).toEqual({
          query: hatchetBacklogQuery("test", workflow),
          targetQueryValue: String(concurrency),
          activationTargetQueryValue: "0",
        });
        expect(trigger.metadata.query, tier).toContain(`starts_with(action_id, 'test_${workflow}:')`);
      }
    });

    it("count queued and held runs through Hatchet's tables, and escape a quote", () => {
      expect(hatchetBacklogQuery("Prod", "ingest-document")).toBe(
        "SELECT (SELECT COUNT(*) FROM v1_queue_item WHERE starts_with(action_id, 'prod_ingest-document:')) + " +
          "(SELECT COUNT(*) FROM v1_task_runtime r JOIN v1_task t ON t.id = r.task_id AND t.inserted_at = r.task_inserted_at " +
          "WHERE starts_with(t.action_id, 'prod_ingest-document:'))",
      );
      expect(hatchetBacklogQuery("x", "a'b")).toContain("'x_a''b:'");
    });

    it("name the workflows the workers register", () => {
      // The Python and TypeScript SDKs prefix `<namespace>_` and lower-case it;
      // the action is `<workflow>:<task>`, so the prefix match counts every task.
      expect(read("deploy", "pulumi", "src", "app", "ingest-worker.ts")).toContain('WORKFLOW = "ingest-document"');
      expect(read("deploy", "pulumi", "src", "app", "agent-worker.ts")).toContain('WORKFLOW = "research-run"');
      expect(read("deploy", "pulumi", "src", "app", "bff-jobs.ts")).toContain('WORKFLOW = "bff-job"');
    });

    it("explain what the cooldown does, which is one step", () => {
      // `cooldownPeriod` is 1 -> 0 only; the comment used to say it delayed every scale-in.
      expect(read("deploy", "pulumi", "src", "app", "keda-scaling.ts")).toMatch(
        /ONE step only: how long after the last\s+\*\s+active trigger a tier is held before it is taken from 1 replica to 0/,
      );
      for (const tier of QUEUE_TIERS) {
        expect(read("deploy", "pulumi", "src", "app", `${tier}.ts`), tier).not.toMatch(/Scale-in waits this long/);
      }
    });
  });

  describe("the chart", () => {
    it("is pinned to the release the plan's CRDs are validated against, from one constant", async () => {
      const { KEDA_CHART_VERSION } = await import("../platform/keda");
      const release = find(RELEASE, "keda").inputs;

      expect(release.version).toBe(KEDA_CHART_VERSION);
      expect(KEDA_CHART_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
      // The validator reads the constant instead of repeating it.
      const validator = read("deploy", "pulumi", "scripts", "validate-crs.mjs");
      expect(validator).toContain("KEDA_CHART_VERSION");
      expect(validator).not.toMatch(/keda\/releases\/download\/v\d/);
    });
  });

  describe("the scaler's credential", () => {
    it("is a read-only login of its own, kept by the rename Jobs and holding nothing but LOGIN", async () => {
      // Not the Cluster's managed role any more: the operator would create the
      // new name beside the old one before the rename ran (ADR-0145 row 10d).
      const { KEDA_SCALER_ROLE } = await import("../constants");
      const spec = await resolve(find(CLUSTER, "grid-pg").inputs.spec as Record<string, any>);
      const managed = spec.managed.roles.map((r: { name: string }) => r.name);
      expect(managed).not.toContain(KEDA_SCALER_ROLE);
      expect(managed).not.toContain("grid_keda_scaler");

      // The script creates it with LOGIN, a connection limit, and nothing else:
      // no BYPASSRLS (its one read of a tenant table is a policy of its own),
      // no inherited rights, no DDL.
      const script = read("deploy", "postgres", "rename-legacy-names.sh");
      expect(script).toContain("grid_keda_scaler:keda_scaler");
      expect(script).toContain('CREATE ROLE $old LOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT ${SCALER_CONNECTION_LIMIT:-4}');
      const env = await resolve(
        find("kubernetes:batch/v1:Job", "pg-rename-legacy-names").inputs.spec.template.spec.containers[0].env as Array<
          Record<string, any>
        >,
      );
      const byName = Object.fromEntries(env.map((e) => [e.name, e]));
      expect(byName.SCALER_PASSWORD.valueFrom.secretKeyRef.name).toBe("grid-pg-keda-scaler-credentials");
      expect(Number(byName.SCALER_CONNECTION_LIMIT.value)).toBeGreaterThan(0);
      expect(byName.ENSURE_RLS_ROLES.value).toBe("1");
    });

    it("has a password that is neither the owner's nor the runtime role's, and is stable", async () => {
      const secret = await stringData("pg-keda-scaler-credentials");

      expect(secret.username).toBe("keda_scaler");
      expect(secret.password).toBe(scalerPassword);
      expect(scalerPassword).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect([scalerPassword]).not.toContain(await resolve(cfg.postgres.appPassword));
      expect([scalerPassword]).not.toContain(await resolve(cfg.postgres.runtimePassword));
    });

    it("can be set on its own, to rotate it without touching the owner's", async () => {
      pulumi.runtime.setAllConfig({ ...baseStackConfig(), ...STACK, "grid-oib:pgScalerPassword": "chosen-scaler-secret" }); // pragma: allowlist secret
      const { loadConfig } = await import("../config");

      expect(await resolve(loadConfig().postgres.scalerPassword)).toBe("chosen-scaler-secret");
      pulumi.runtime.setAllConfig({ ...baseStackConfig(), ...STACK });
    });

  });

  describe("the backlog the scaler reads", () => {
    it("is read as the read-only login on background-work-pg, from a Secret no pod reads", async () => {
      const secret = await stringData("background-work-keda-scaler");
      expect(Object.keys(secret)).toEqual(["KEDA_BACKGROUND_WORK_DB_URL"]);
      expect(secret.KEDA_BACKGROUND_WORK_DB_URL).toMatch(
        /^postgresql:\/\/keda_scaler:[^@]+@background-work-pg-rw\.background-work\.svc\.cluster\.local:5432\/hatchet\?sslmode=require$/,
      );
      const auth = await resolve(find(AUTH, "hatchet-queue-auth").inputs.spec as Record<string, any>);
      expect(auth.secretTargetRef).toEqual([
        { parameter: "connection", name: "background-work-keda-scaler", key: "KEDA_BACKGROUND_WORK_DB_URL" },
      ]);
      const shared = await stringData("grid-secrets");
      expect(Object.keys(shared).filter((k) => k.startsWith("KEDA_"))).toEqual([]);
    });

    it("is granted the columns the count reads and no other right, and the owner a statement timeout", async () => {
      const { backgroundWorkGrantsSql } = await import("../data/background-work-pg");
      const sql = backgroundWorkGrantsSql();
      expect(sql).toBe(
        [
          "ALTER ROLE hatchet SET statement_timeout = '5min';",
          "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM keda_scaler;",
          "GRANT SELECT (action_id) ON v1_queue_item TO keda_scaler;",
          "GRANT SELECT (id, inserted_at, action_id) ON v1_task TO keda_scaler;",
          "GRANT SELECT (task_id, task_inserted_at) ON v1_task_runtime TO keda_scaler;",
          "",
        ].join("\n"),
      );
      expect(sql).not.toMatch(/\bGRANT (INSERT|UPDATE|DELETE|TRUNCATE|ALL)\b|GRANT SELECT ON/i);
      // Every column the backlog query names is one the scaler holds.
      const query = hatchetBacklogQuery("x", "y");
      for (const column of ["action_id", "task_id", "task_inserted_at", "inserted_at"]) expect(query).toContain(column);
      expect(query).not.toMatch(/\binput\b/);
    });

    it("is in place before any worker tier's ScaledObject, by the program's own ordering", () => {
      const index = read("deploy", "pulumi", "index.ts");
      expect(index).toMatch(/const hatchetGrants = backgroundWorkPg\.grants\(\[hatchet\.release\]\)/);
      expect(index).toMatch(/const queueScalerDeps = \[[\s\S]*?hatchetQueueAuth, hatchetGrants, hatchet\.tokenSync\]/);
      expect(index).toMatch(/installBffJobs\(wiring, cfg, secrets, \[[\s\S]*?\.\.\.queueScalerDeps/);
      expect(read("deploy", "pulumi", "src", "app", "keda-scaling.ts")).toMatch(
        /dependsOn: \[tier\.deployment, \.\.\.tier\.dependsOn\]/,
      );
    });

    it("leaves no claim-queue grant behind on the app cluster", () => {
      expect(RESOURCES.find((r) => r.name === "keda-scaler-grants")).toBeUndefined();
      expect(RESOURCES.find((r) => r.name === "jobs-queue-auth")).toBeUndefined();
      expect(RESOURCES.find((r) => r.name === "grid-keda-scaler")).toBeUndefined();
    });
  });

  describe("the grace period", () => {
    it("is the drain plus 30 s on both Python worker tiers and the BFF pool, so the release path runs before SIGKILL", async () => {
      const drains: Record<string, number> = {
        "ingest-worker": cfg.ingestWorker.drainSeconds,
        "agent-worker": cfg.agentWorker.drainSeconds,
        "bff-jobs": cfg.bffJobs.drainSeconds,
      };
      for (const [tier, drain] of Object.entries(drains)) {
        const spec = await resolve(find(DEPLOYMENT, tier).inputs.spec as Record<string, any>);
        expect(spec.template.spec.terminationGracePeriodSeconds, tier).toBe(drain + 30);
      }
    });

    it("is one rule in one place", async () => {
      const { DRAIN_GIVE_BACK_SECONDS } = await import("../platform/rollout");
      expect(DRAIN_GIVE_BACK_SECONDS).toBe(30);
      for (const tier of QUEUE_TIERS) {
        expect(read("deploy", "pulumi", "src", "app", `${tier}.ts`), tier).not.toMatch(/\+ (GIVE_BACK|EXIT)_SLACK_SECONDS/);
      }
    });
  });

  describe("the network", () => {
    it("lets KEDA's operator, and only it, reach exactly the targets its triggers name", async () => {
      const operator = {
        namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "keda" } },
        podSelector: { matchLabels: { "app.kubernetes.io/name": "keda-operator" } },
      };
      const kedaPolicies = [];
      for (const r of RESOURCES.filter((x) => x.type === NETPOL)) {
        const spec = await resolve(r.inputs.spec as Record<string, any>);
        if (JSON.stringify(spec.ingress ?? []).includes('"kubernetes.io/metadata.name":"keda"')) {
          kedaPolicies.push({ name: r.name, spec });
        }
      }

      // Hatchet's Postgres for the backlog, the backend for the occupancy route: nothing more.
      expect(kedaPolicies.map((p) => p.name).sort()).toEqual(["allow-keda-to-chat", "background-work-allow-keda-to-postgres"]);
      const byName = Object.fromEntries(kedaPolicies.map((p) => [p.name, p.spec]));
      const pg = byName["background-work-allow-keda-to-postgres"];
      expect(pg.ingress).toEqual([{ from: [operator], ports: [{ protocol: "TCP", port: 5432 }] }]);
      expect(pg.podSelector.matchLabels).toEqual({ "cnpg.io/cluster": "background-work-pg" });
      expect(byName["allow-keda-to-chat"].ingress).toEqual([{ from: [operator], ports: [{ protocol: "TCP", port: 8000 }] }]);
    });

    it("selects the operator by the label the pinned chart gives its pods", () => {
      // chart keda-2.21.0, templates/manager/deployment.yaml: pod labels
      // `app.kubernetes.io/name: {{ .Values.operator.name }}`, default `keda-operator`.
      return import("../platform/keda").then(({ KEDA_OPERATOR_LABEL }) => {
        expect(KEDA_OPERATOR_LABEL).toEqual({ "app.kubernetes.io/name": "keda-operator" });
      });
    });
  });
});
