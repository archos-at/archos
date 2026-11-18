import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { loadConfig } from '../config'
import { baseStackConfig, langfuseStackConfig } from "../test-support/stack-config";
import { parseCollectorConfig, pipeline } from "../test-support/collector";
import { BFF_SERVICE_NAME } from "../app/config";
import { BFF_JOBS_SERVICE_NAME } from "../app/bff-jobs-env";

const RESOURCES: Array<{ type: string; name: string; inputs: Record<string, unknown> }> = [];

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

function resolve(value: unknown): Promise<any> {
  return new Promise((done) =>
    (pulumi.output(value) as pulumi.Output<any>).apply((v: any) => {
      done(v);
      return v;
    }),
  );
}

function find(type: string, name: string) {
  const hit = RESOURCES.find((r) => r.type === type && r.name === name);
  if (!hit) {
    throw new Error(
      `no ${type} named "${name}". Built: ${RESOURCES.filter((r) => r.type === type).map((r) => r.name).join(", ") || "(none)"}`,
    );
  }
  return hit;
}

function has(type: string, name: string): boolean {
  return RESOURCES.some((r) => r.type === type && r.name === name);
}

const SECRET_SIGNATURE = "4dabf18193072939515e22adb298388d"; // pragma: allowlist secret
function unsecret<T>(value: unknown): T {
  return (value && typeof value === "object" && SECRET_SIGNATURE in (value as object)
    ? (value as { value: T }).value
    : value) as T;
}

async function s3Identities(): Promise<Array<{ name: string; actions: string[] }>> {
  const secret = find("kubernetes:core/v1:Secret", "seaweedfs-s3-config");
  const data = unsecret<Record<string, string>>(await resolve(secret.inputs.stringData));
  return JSON.parse(data["s3.json"]).identities;
}

async function containerEnv(
  name: string,
  type = "kubernetes:apps/v1:Deployment",
): Promise<Record<string, unknown>> {
  const spec = (await resolve(find(type, name).inputs.spec)) as any;
  const env = spec.template.spec.containers[0].env as Array<{ name: string; value?: string; valueFrom?: unknown }>;
  return Object.fromEntries(env.map((e) => [e.name, e.value ?? e.valueFrom]));
}

async function podChecksum(name: string, type = "kubernetes:apps/v1:Deployment"): Promise<string> {
  const spec = (await resolve(find(type, name).inputs.spec)) as any;
  const annotations = (spec.template.metadata.annotations ?? {}) as Record<string, string>;
  const key = Object.keys(annotations).find((k) => /checksum/i.test(k));
  if (!key) throw new Error(`${name} has no checksum annotation`);
  return annotations[key];
}

function callers(spec: any): string[] {
  return (spec.ingress[0].from as any[]).map((f) => f.podSelector.matchLabels["app.kubernetes.io/name"]).sort();
}

describe("with the Langfuse tier enabled", () => {
  let collectorConfig: string;

  beforeAll(async () => {
    RESOURCES.length = 0;
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), ...langfuseStackConfig() });
    await import("../../index");
    await new Promise((r) => setTimeout(r, 200));

    const cm = find("kubernetes:core/v1:ConfigMap", "otel-collector");
    collectorConfig = ((await resolve(cm.inputs.data)) as Record<string, string>)["collector.yaml"];
  });

  it("builds the whole tier: web, worker, ClickHouse and a dedicated queue", () => {
    expect(has("kubernetes:apps/v1:Deployment", "langfuse-web")).toBe(true);
    expect(has("kubernetes:apps/v1:Deployment", "langfuse-worker")).toBe(true);
    expect(has("kubernetes:apps/v1:StatefulSet", "clickhouse")).toBe(true);
    expect(has("kubernetes:apps/v1:Deployment", "dragonfly-langfuse")).toBe(true);
  });

  describe("collector fan-out", () => {
    it("gives the traces pipeline to Langfuse alone, without the BFF's request spans", () => {
      const { processors, service } = parseCollectorConfig(collectorConfig);
      expect(service.pipelines.traces).toEqual(
        pipeline(["otlp_http/langfuse"], { processors: ["filter/drop_app_spans"] }),
      );
      expect(processors["filter/drop_app_spans"]).toEqual({
        error_mode: "ignore",
        trace_conditions: [
          `resource.attributes["service.name"] == "${BFF_SERVICE_NAME}" or resource.attributes["service.name"] == "${BFF_JOBS_SERVICE_NAME}"`,
        ],
      });
    });

    it("sends it no logs and no metrics", () => {
      const users = Object.entries(parseCollectorConfig(collectorConfig).service.pipelines)
        .filter(([, p]) => p.exporters.includes("otlp_http/langfuse"))
        .map(([name]) => name);
      expect(users).toEqual(["traces"]);
    });

    it("uses the component's CURRENT type id, not its deprecated alias", () => {
      expect(collectorConfig).toContain("otlp_http/langfuse:");
      expect(collectorConfig).not.toMatch(/^\s+otlphttp\//m);
    });

    it("posts to the full signal path, via traces_endpoint", () => {
      expect(collectorConfig).toContain(
        "traces_endpoint: http://langfuse-web:3000/api/public/otel/v1/traces",
      );
      expect(collectorConfig).not.toMatch(/^\s+endpoint: http:\/\/langfuse-web/m);
    });

    it("marks its spans as v4 ingestion, so they land without the propagation delay", () => {
      const exporter = parseCollectorConfig(collectorConfig).exporters["otlp_http/langfuse"] as {
        headers: Record<string, string>;
      };
      expect(exporter.headers["x-langfuse-ingestion-version"]).toBe("4");
    });

    it("reads its credential from the environment, never the ConfigMap", async () => {
      expect(collectorConfig).toContain("Authorization: ${env:LANGFUSE_OTLP_AUTH}");
      expect(collectorConfig).not.toContain("pk-lf-test");
      expect(collectorConfig).not.toContain("sk-lf-test");

      const env = await containerEnv("otel-collector");
      expect(env.LANGFUSE_OTLP_AUTH).toBeDefined();
    });

    it("rolls the collector when the ingestion key rotates", async () => {
      const spec = (await resolve(
        find("kubernetes:apps/v1:Deployment", "otel-collector").inputs.spec,
      )) as any;

      expect(Object.keys(spec.template.metadata.annotations ?? {}).join()).toMatch(/checksum/i);
    });

    it("bounds the Langfuse queue so an outage cannot grow the collector without limit", () => {
      expect(collectorConfig).toMatch(/sending_queue:\s*\n\s*enabled: true\s*\n\s*queue_size: 2000/);
    });
  });

  describe("migrations", () => {
    it("writes v4's events table only, on both containers alike", async () => {
      for (const name of ["langfuse-web", "langfuse-worker"]) {
        const env = await containerEnv(name);
        expect(env.LANGFUSE_MIGRATION_V4_WRITE_MODE).toBe("events_only");
        expect(env.LANGFUSE_MIGRATION_V4_NATIVE_OTEL_BEHAVIOUR).toBe("direct");
        expect(env.LANGFUSE_BACKGROUND_MIGRATION_V4_ENABLE_HISTORIC_BACKFILL).toBe("false");
      }
    });

    it("gives the worker the public URL, which its PostHog export builds langfuse_url from", async () => {
      const web = await containerEnv("langfuse-web");
      const worker = await containerEnv("langfuse-worker");

      expect(worker.NEXTAUTH_URL).toBeTruthy();
      expect(worker.NEXTAUTH_URL).toBe(web.NEXTAUTH_URL);
    });

    it("gives them to exactly one container", async () => {
      const web = await containerEnv("langfuse-web");
      const worker = await containerEnv("langfuse-worker");

      expect(web.LANGFUSE_AUTO_POSTGRES_MIGRATION_DISABLED).toBeUndefined();
      expect(web.LANGFUSE_AUTO_CLICKHOUSE_MIGRATION_DISABLED).toBeUndefined();
      expect(worker.LANGFUSE_AUTO_POSTGRES_MIGRATION_DISABLED).toBe("true");
      expect(worker.LANGFUSE_AUTO_CLICKHOUSE_MIGRATION_DISABLED).toBe("true");
    });

    it("keeps the web tier at one replica while it owns them", async () => {
      const spec = (await resolve(
        find("kubernetes:apps/v1:Deployment", "langfuse-web").inputs.spec,
      )) as any;
      expect(spec.replicas).toBe(1);
    });

    it("gives the migration longer than the rollout deadline allows to fail it", async () => {
      const spec = (await resolve(
        find("kubernetes:apps/v1:Deployment", "langfuse-web").inputs.spec,
      )) as any;
      const probe = spec.template.spec.containers[0].startupProbe;
      const probeBudget = probe.periodSeconds * probe.failureThreshold;

      expect(spec.progressDeadlineSeconds).toBeGreaterThan(
        probeBudget + spec.minReadySeconds,
      );
    });
  });

  describe("images", () => {
    it.each([
      ["langfuse-web", "webImage"],
      ["langfuse-worker", "workerImage"],
    ] as const)("runs %s on its pinned %s", async (name, key) => {
      const spec = (await resolve(
        find("kubernetes:apps/v1:Deployment", name).inputs.spec,
      )) as any;
      const images = spec.template.spec.containers.map((c: { image: string }) => c.image);

      expect(images).toContain(loadConfig().langfuse[key]);
      expect(loadConfig().langfuse[key]).toMatch(/^ghcr\.io\/langfuse\/langfuse(-worker)?@sha256:[0-9a-f]{64}$/);
    });
  });

  describe("runtime user", () => {
    it.each(["langfuse-web", "langfuse-worker"])("runs %s as the uid its image owns", async (name) => {
      const spec = (await resolve(
        find("kubernetes:apps/v1:Deployment", name).inputs.spec,
      )) as any;

      expect(spec.template.spec.securityContext).toMatchObject({
        runAsNonRoot: true,
        runAsUser: 1001,
        runAsGroup: 1001,
      });
    });
  });

  describe("ClickHouse", () => {
    it("matches the schema shape the migrator will emit", async () => {
      const web = await containerEnv("langfuse-web");
      expect(web.CLICKHOUSE_CLUSTER_ENABLED).toBe("false");
    });

    it("gives the migrator the native port and the app the HTTP one", async () => {
      const web = await containerEnv("langfuse-web");
      expect(web.CLICKHOUSE_URL).toBe("http://clickhouse:8123");
      expect(web.CLICKHOUSE_MIGRATION_URL).toBe("clickhouse://clickhouse:9000");
    });

    it("runs on a non-default login, which is what removes the passwordless superuser", async () => {
      const spec = (await resolve(
        find("kubernetes:apps/v1:StatefulSet", "clickhouse").inputs.spec,
      )) as any;
      const env = Object.fromEntries(
        spec.template.spec.containers[0].env.map((e: any) => [e.name, e.value ?? e.valueFrom]),
      );
      expect(env.CLICKHOUSE_USER).toBe("langfuse");
      expect(env.CLICKHOUSE_USER).not.toBe("default");
      expect(env.TZ).toBe("UTC");
    });

    it("keeps its PVC when the StatefulSet goes away", async () => {
      const spec = (await resolve(
        find("kubernetes:apps/v1:StatefulSet", "clickhouse").inputs.spec,
      )) as any;
      expect(spec.persistentVolumeClaimRetentionPolicy).toEqual({
        whenDeleted: "Retain",
        whenScaled: "Retain",
      });
    });
  });

  describe("secrets", () => {
    it("passes every credential by reference, never as a literal env value", async () => {
      for (const name of ["langfuse-web", "langfuse-worker"]) {
        const spec = (await resolve(
          find("kubernetes:apps/v1:Deployment", name).inputs.spec,
        )) as any;
        const literals = (spec.template.spec.containers[0].env as any[])
          .filter((e) => typeof e.value === "string")
          .map((e) => e.value as string);

        for (const secret of ["lf-db", "lf-ch", "lf-queue", "lf-s3", "sk-lf-test", "lf-init-user"]) {
          expect(literals, `${name} leaked ${secret} onto its pod spec`).not.toContain(secret);
        }
      }
    });

    it("rolls the pods when a credential rotates", async () => {
      for (const name of ["langfuse-web", "langfuse-worker"]) {
        const spec = (await resolve(
          find("kubernetes:apps/v1:Deployment", name).inputs.spec,
        )) as any;
        expect(Object.keys(spec.template.metadata.annotations ?? {}).join()).toMatch(/checksum/i);
      }
    });
  });

  describe("object storage", () => {
    it("scopes the Langfuse S3 identity to its own bucket and nothing else", async () => {
      const identities = await s3Identities();
      const langfuse = identities.find((i) => i.name === "grid-langfuse");
      expect(langfuse?.actions.sort()).toEqual(
        ["List:langfuse", "Read:langfuse", "Tagging:langfuse", "Write:langfuse"],
      );
      for (const action of langfuse?.actions ?? []) {
        expect(action).toContain(":");
      }
    });

    it("withholds the trace bucket from the general-purpose `grid` credential", async () => {
      const identities = await s3Identities();
      const grid = identities.find((i) => i.name === "grid");

      expect(grid?.actions.some((a) => a.endsWith(":langfuse"))).toBe(false);
      expect(grid?.actions).toContain("Write:grid-documents");
    });
  });

  describe("network isolation", () => {
    it("withholds the tier from the wholesale intra-namespace allow", async () => {
      const spec = (await resolve(
        find("kubernetes:networking.k8s.io/v1:NetworkPolicy", "allow-same-namespace").inputs.spec,
      )) as any;
      const withheld = spec.podSelector.matchExpressions[0].values as string[];

      expect(withheld).toEqual(
        expect.arrayContaining(["langfuse-web", "langfuse-worker", "clickhouse"]),
      );
    });

    it("leaves the worker's egress open so the PostHog export can reach its host", async () => {
      const policies = RESOURCES.filter((r) => r.type === "kubernetes:networking.k8s.io/v1:NetworkPolicy");
      expect(policies.length).toBeGreaterThan(0);
      for (const policy of policies) {
        const spec = (await resolve(policy.inputs.spec)) as any;
        const selectsWorker =
          spec.podSelector?.matchLabels?.["app.kubernetes.io/name"] === "langfuse-worker" ||
          spec.podSelector?.matchExpressions !== undefined;
        if (selectsWorker) expect(spec.policyTypes, policy.name).not.toContain("Egress");
      }
    });

    it("names the only two callers ClickHouse has", async () => {
      const spec = (await resolve(
        find("kubernetes:networking.k8s.io/v1:NetworkPolicy", "allow-langfuse-to-clickhouse")
          .inputs.spec,
      )) as any;
      const from = spec.ingress[0].from as any[];

      expect(from.map((f) => f.podSelector.matchLabels["app.kubernetes.io/name"]).sort()).toEqual([
        "langfuse-web",
        "langfuse-worker",
      ]);
    });

    it("lets the collector and the edge reach the web tier", () => {
      expect(has("kubernetes:networking.k8s.io/v1:NetworkPolicy", "allow-collector-to-langfuse")).toBe(true);
      expect(has("kubernetes:networking.k8s.io/v1:NetworkPolicy", "allow-edge-to-langfuse")).toBe(true);
    });

    it("names the purger and bff-jobs as the only API callers, on the web port", async () => {
      const spec = (await resolve(
        find("kubernetes:networking.k8s.io/v1:NetworkPolicy", "allow-workers-to-langfuse").inputs.spec,
      )) as any;

      expect(spec.podSelector.matchLabels["app.kubernetes.io/name"]).toBe("langfuse-web");
      expect(
        (spec.ingress[0].from as any[]).map((f) => f.podSelector.matchLabels["app.kubernetes.io/name"]).sort(),
      ).toEqual(["bff-jobs", "purger"]);
      expect(spec.ingress[0].ports).toEqual([{ protocol: "TCP", port: 3000 }]);
    });
  });

  describe("edge", () => {
    it("gates the UI on the platform permission, not merely on being signed in", async () => {
      const spec = (await resolve(
        find("kubernetes:gateway.envoyproxy.io/v1alpha1:SecurityPolicy", "grid-langfuse-security-policy")
          .inputs.spec,
      )) as any;

      expect(spec.authorization.defaultAction).toBe("Deny");
      expect(spec.authorization.rules[0].principal.jwt.scopes).toContain(
        "platform:organizations:view",
      );
      expect(spec.oidc.redirectURL).toBe("https://langfuse.example.test/oauth2/callback");
    });

    it("also admits the read-only observability permission, on a rule of its own", async () => {
      const spec = (await resolve(
        find("kubernetes:gateway.envoyproxy.io/v1alpha1:SecurityPolicy", "grid-langfuse-security-policy")
          .inputs.spec,
      )) as any;
      const rules = spec.authorization.rules as any[];

      expect(rules.map((r) => r.principal.jwt.scopes)).toEqual([
        ["platform:organizations:view"],
        ["platform:observability:view"],
      ]);
      expect(rules.every((r) => r.action === "Allow")).toBe(true);
      expect(new Set(rules.map((r) => r.name)).size).toBe(rules.length);
      expect(spec.oidc.scopes).toEqual(
        expect.arrayContaining(["platform:organizations:view", "platform:observability:view"]),
      );
    });

    it("serves the hostname on its own TLS listener", async () => {
      const spec = (await resolve(
        find("kubernetes:gateway.networking.k8s.io/v1:Gateway", "grid-gateway").inputs.spec,
      )) as any;
      const listener = (spec.listeners as any[]).find((l) => l.name === "https-langfuse");

      expect(listener?.hostname).toBe("langfuse.example.test");
      expect(listener?.tls.certificateRefs[0].name).toBe("grid-langfuse-tls");
    });
  });

  describe("the BFF as a score writer", () => {
    it("hands the frontend the in-cluster API, the public UI and the project", async () => {
      const env = await containerEnv("frontend");

      expect(env.LANGFUSE_HOST).toBe("http://langfuse-web:3000");
      expect(env.LANGFUSE_PUBLIC_URL).toBe("https://langfuse.example.test");
      expect(env.LANGFUSE_PROJECT_ID).toBe("grid-oib");
    });

    it("passes the keys by reference to the Langfuse Secret, never as literals", async () => {
      const env = await containerEnv("frontend");

      expect(env.LANGFUSE_PUBLIC_KEY).toEqual({ secretKeyRef: { name: "langfuse-secrets", key: "public-key" } });
      expect(env.LANGFUSE_SECRET_KEY).toEqual({ secretKeyRef: { name: "langfuse-secrets", key: "secret-key" } });
    });

    it("lets the frontend, and only it among the app pods, reach the web tier", async () => {
      const spec = (await resolve(
        find("kubernetes:networking.k8s.io/v1:NetworkPolicy", "allow-frontend-to-langfuse").inputs.spec,
      )) as any;

      expect(spec.podSelector.matchLabels["app.kubernetes.io/name"]).toBe("langfuse-web");
      expect(spec.ingress[0].from).toEqual([{ podSelector: { matchLabels: { "app.kubernetes.io/name": "frontend" } } }]);
      expect(spec.ingress[0].ports).toEqual([{ protocol: "TCP", port: 3000 }]);
    });
  });

  describe("default membership for SSO users", () => {
    it("joins a new user to the seeded org and project as VIEWER", async () => {
      const web = await containerEnv("langfuse-web");

      expect(web.LANGFUSE_DEFAULT_ORG_ID).toBe("grid");
      expect(web.LANGFUSE_DEFAULT_ORG_ID).toBe(web.LANGFUSE_INIT_ORG_ID);
      expect(web.LANGFUSE_DEFAULT_ORG_ROLE).toBe("VIEWER");
      expect(web.LANGFUSE_DEFAULT_PROJECT_ID).toBe("grid-oib");
      expect(web.LANGFUSE_DEFAULT_PROJECT_ID).toBe(web.LANGFUSE_INIT_PROJECT_ID);
      expect(web.LANGFUSE_DEFAULT_PROJECT_ROLE).toBe("VIEWER");
    });

    it("sets it on the web tier only, which is where accounts are created", async () => {
      const worker = await containerEnv("langfuse-worker");

      expect(Object.keys(worker).filter((k) => k.startsWith("LANGFUSE_DEFAULT_"))).toEqual([]);
    });
  });

  describe("the backend as a score writer", () => {
    const BACKEND_TIERS: Array<[string, string]> = [
      ["aiq-agent", "kubernetes:apps/v1:StatefulSet"],
      ["aiq-api", "kubernetes:apps/v1:Deployment"],
      ["chat", "kubernetes:apps/v1:StatefulSet"],
      ["api", "kubernetes:apps/v1:Deployment"],
      ["agent-worker", "kubernetes:apps/v1:Deployment"],
    ];

    it.each(BACKEND_TIERS)("hands %s the in-cluster API and the keys by reference", async (name, type) => {
      const env = await containerEnv(name, type);

      expect(env.LANGFUSE_HOST).toBe("http://langfuse-web:3000");
      expect(env.LANGFUSE_PUBLIC_KEY).toEqual({ secretKeyRef: { name: "langfuse-secrets", key: "public-key" } });
      expect(env.LANGFUSE_SECRET_KEY).toEqual({ secretKeyRef: { name: "langfuse-secrets", key: "secret-key" } });
      expect(env.LANGFUSE_PROMPTS_ENABLED).toBeUndefined();
    });

    it("withholds the keys from the ingest worker, which writes no score", async () => {
      const env = await containerEnv("ingest-worker");

      expect(Object.keys(env).filter((k) => k.startsWith("LANGFUSE_"))).toEqual([]);
    });

    it("lets exactly the three key-holding backend roles reach the web tier, chat and api under both names", async () => {
      const spec = (await resolve(
        find("kubernetes:networking.k8s.io/v1:NetworkPolicy", "allow-backend-to-langfuse").inputs.spec,
      )) as any;

      expect(spec.podSelector.matchLabels["app.kubernetes.io/name"]).toBe("langfuse-web");
      expect(callers(spec)).toEqual(["agent-worker", "aiq-agent", "aiq-api", "api", "chat"]);
      expect(spec.ingress[0].ports).toEqual([{ protocol: "TCP", port: 3000 }]);
    });

    it("names in the policy every backend tier that carries the keys", async () => {
      const spec = (await resolve(
        find("kubernetes:networking.k8s.io/v1:NetworkPolicy", "allow-backend-to-langfuse").inputs.spec,
      )) as any;
      for (const [name, type] of BACKEND_TIERS) {
        if ((await containerEnv(name, type)).LANGFUSE_HOST) expect(callers(spec)).toContain(name);
      }
    });

    it.each([...BACKEND_TIERS, ["bff-jobs", "kubernetes:apps/v1:Deployment"] as [string, string]])(
      "rolls %s when the Langfuse keys rotate, as the frontend does",
      async (name, type) => {
        const frontend = await podChecksum("frontend");

        expect(await podChecksum(name, type)).toBe(frontend);
        expect(await podChecksum("ingest-worker")).not.toBe(frontend);
      },
    );
  });

  it("turns on backend identity attributes, which is what makes traces attributable", async () => {
    const spec = (await resolve(
      find("kubernetes:apps/v1:StatefulSet", "aiq-agent").inputs.spec,
    )) as any;
    const env = Object.fromEntries(
      spec.template.spec.containers[0].env.map((e: any) => [e.name, e.value ?? e.valueFrom]),
    );

    expect(env.TRACE_IDENTITY_ATTRIBUTES).toBe("true");
  });
});

describe("the app pods without the Langfuse tier", () => {
  it("get no Langfuse env and keep their rollout checksum as it was", async () => {
    const { frontendLangfuseEnv, withLangfuseKeysChecksum } = await import("./langfuse");
    const { langfuseApiEnv } = await import("../app/config");
    const off = { langfuse: { enabled: false } } as never;

    expect(frontendLangfuseEnv(off)).toEqual([]);
    expect(langfuseApiEnv(off)).toEqual([]);
    expect(withLangfuseKeysChecksum(off, "app-sum")).toBe("app-sum");
  });
});

describe("the Langfuse keys in a rollout checksum", () => {
  it("change it when either key rotates", async () => {
    const { withLangfuseKeysChecksum } = await import("./langfuse");
    const on = (secretKey: string) =>
      ({
        langfuse: { enabled: true, publicKey: pulumi.output("pk-lf-a"), secretKey: pulumi.output(secretKey) },
      }) as never;

    const before = await resolve(withLangfuseKeysChecksum(on("sk-lf-1"), "app-sum"));
    const after = await resolve(withLangfuseKeysChecksum(on("sk-lf-2"), "app-sum"));

    expect(before).not.toBe("app-sum");
    expect(after).not.toBe(before);
  });
});

describe("default membership env", () => {
  it("gives NONE the org alone: the project role has no NONE, and a project grant would contradict it", async () => {
    const { langfuseDefaultMembershipEnv } = await import("./langfuse");
    const env = langfuseDefaultMembershipEnv({ orgId: "grid", projectId: "grid-oib", defaultRole: "NONE" });

    expect(env).toEqual([
      { name: "LANGFUSE_DEFAULT_ORG_ID", value: "grid" },
      { name: "LANGFUSE_DEFAULT_ORG_ROLE", value: "NONE" },
    ]);
  });

  it("gives every other role to both the org and the project", async () => {
    const { langfuseDefaultMembershipEnv } = await import("./langfuse");
    const env = langfuseDefaultMembershipEnv({ orgId: "o", projectId: "p", defaultRole: "MEMBER" });

    expect(Object.fromEntries(env.map((e) => [e.name, e.value]))).toEqual({
      LANGFUSE_DEFAULT_ORG_ID: "o",
      LANGFUSE_DEFAULT_ORG_ROLE: "MEMBER",
      LANGFUSE_DEFAULT_PROJECT_ID: "p",
      LANGFUSE_DEFAULT_PROJECT_ROLE: "MEMBER",
    });
  });
});

describe("the platform OIDC gate", () => {
  const cfg = {
    observability: { oidcIssuer: "https://auth.example.test", oidcClientId: "client_x" },
  } as never;

  it("widens only the route that names a permission, and never repeats one", async () => {
    const { platformOidcSecurityPolicySpec } = await import("./platform-oidc");
    const gate = { routeName: "r", domain: "d.example.test", secretName: "s" };

    const plain = platformOidcSecurityPolicySpec(cfg, gate);
    const doubled = platformOidcSecurityPolicySpec(cfg, {
      ...gate,
      alsoAdmit: ["platform:organizations:view", "platform:observability:view"],
    });

    expect(plain.authorization?.rules?.map((r) => r.principal.jwt?.scopes)).toEqual([["platform:organizations:view"]]);
    expect(doubled.authorization?.rules?.map((r) => r.principal.jwt?.scopes)).toEqual([
      ["platform:organizations:view"],
      ["platform:observability:view"],
    ]);
    expect(doubled.oidc?.scopes?.filter((scope) => scope.startsWith("platform:"))).toEqual([
      "platform:organizations:view",
      "platform:observability:view",
    ]);
  });
});

describe("the rollout-budget guard", () => {
  it("refuses a probe budget that can outlive its rollout deadline", async () => {
    const { assertStartupFitsRollout } = await import("./rollout");

    expect(() =>
      assertStartupFitsRollout(
        "test-workload",
        { minReadySeconds: 10, progressDeadlineSeconds: 600, terminationGracePeriodSeconds: 30, endpointDrainSeconds: 0 },
        600, // exactly the deadline — the shape the Langfuse web tier shipped with
      ),
    ).toThrow(/exceeds progressDeadlineSeconds/);
  });

  it("accepts a deadline with room for the probe, the soak and the image pull", async () => {
    const { assertStartupFitsRollout, ROLLOUT, startupBudgetSeconds } = await import("./rollout");

    expect(() =>
      assertStartupFitsRollout("langfuse-web", ROLLOUT.langfuse, startupBudgetSeconds(10, 60)),
    ).not.toThrow();
  });
});

describe("config gating", () => {
  function loadWith(values: Record<string, string>, omit: string[] = []): Error | null {
    const config: Record<string, string> = {
      ...baseStackConfig(),
      ...langfuseStackConfig(),
      ...values,
    };
    for (const key of omit) delete config[key];
    pulumi.runtime.setAllConfig(config);
    try {
      loadConfig();
      return null;
    } catch (error) {
      return error as Error;
    }
  }

  it("accepts the fully configured tier", () => {
    expect(loadWith({})).toBeNull();
  });

  it("refuses a stack that still sets the removed v4 write mode", () => {
    const error = loadWith({ "grid-oib:langfuseV4WriteMode": "dual" });
    expect(error?.message).toMatch(/langfuseV4WriteMode was removed/);
  });

  it("defaults new Langfuse users to VIEWER", () => {
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), ...langfuseStackConfig() });
    expect(loadConfig().langfuse.defaultRole).toBe("VIEWER");
  });

  it.each(["OWNER", "ADMIN", "MEMBER", "VIEWER", "NONE"])("accepts %s as the default role", (role) => {
    expect(loadWith({ "grid-oib:langfuseDefaultRole": role })).toBeNull();
    expect(loadConfig().langfuse.defaultRole).toBe(role);
  });

  it.each(["viewer", "READ", "EDITOR"])("refuses %s as the default role", (role) => {
    const error = loadWith({ "grid-oib:langfuseDefaultRole": role });
    expect(error?.message).toMatch(/langfuseDefaultRole must be one of OWNER, ADMIN, MEMBER, VIEWER, NONE/);
  });

  it("refuses a base64 encryption key, which is the natural mistake", () => {
    const error = loadWith({
      "grid-oib:langfuseEncryptionKey": "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4",
    });
    expect(error?.message).toMatch(/64 hex characters/);
  });

  it.each([
    ["langfusePublicKey", "pk-lf-"],
    ["langfuseSecretKey", "sk-lf-"],
  ])("refuses %s without the prefix Langfuse validates", (key, prefix) => {
    const error = loadWith({ [`grid-oib:${key}`]: "not-a-key" });
    expect(error?.message).toContain(prefix);
  });

  it.each([
    ["base64 padding", "c2VjcmV0LXZhbHVlLWZvci10ZXN0aW5nLW9ubHk="],
    ["a plus sign", "abc+def"],
    ["an ampersand", "abc&def"],
    ["a slash", "abc/def"],
  ])("refuses a ClickHouse password containing %s", (_label, value) => {
    const error = loadWith({ "grid-oib:langfuseClickhousePassword": value });
    expect(error?.message).toMatch(/must contain only URL-safe characters/);
  });

  it("accepts a hex ClickHouse password, which is what the docs now generate", () => {
    expect(loadWith({ "grid-oib:langfuseClickhousePassword": "a".repeat(64) })).toBeNull();
  });

  it("refuses a queue password shared with another Redis instance", () => {
    const error = loadWith({ "grid-oib:langfuseQueuePassword": "df" });
    expect(error?.message).toMatch(/must differ from grid-oib:dragonflyPassword/);
  });

  it("refuses an S3 key shared with a wider-scoped identity", () => {
    const error = loadWith({ "grid-oib:langfuseS3SecretKey": "s3-secret" });
    expect(error?.message).toMatch(/must differ from grid-oib:seaweedfsSecretKey/);
  });

  it("refuses the tier with NetworkPolicies off, on a guard of its own", () => {
    const error = loadWith({ "grid-oib:networkPolicies": "false" });
    expect(error?.message).toMatch(/requires grid-oib:networkPolicies/);
  });

  it("skips the tier, rather than half-deploying it, when a credential is missing", () => {
    expect(loadWith({}, ["grid-oib:langfuseSalt"])).toBeNull();
    pulumi.runtime.setAllConfig({
      ...baseStackConfig(),
      ...langfuseStackConfig(),
      "grid-oib:langfuseSalt": "",
    });
    expect(loadConfig().langfuse.enabled).toBe(false);
  });

  it("skips the tier when the collector that feeds it is not deployed", () => {
    pulumi.runtime.setAllConfig({
      ...baseStackConfig(),
      ...langfuseStackConfig(),
      "grid-oib:observabilityEnabled": "false",
    });
    expect(loadConfig().langfuse.enabled).toBe(false);
  });

  it("stays off by default", () => {
    pulumi.runtime.setAllConfig(baseStackConfig());
    expect(loadConfig().langfuse.enabled).toBe(false);
  });
});
