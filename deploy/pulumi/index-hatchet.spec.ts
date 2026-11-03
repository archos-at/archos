import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { PROJECT } from "./src/names";
import { baseStackConfig, forProject } from "./src/test-support/stack-config";

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");

/**
 * Built as the brand-free project (ADR-0147), so the app namespace is
 * `workspace` and the app cluster `postgres`; the background-work names are
 * the same in both projects.
 */
const APP_NAMESPACE = "workspace";
const stackConfig = (extra: Record<string, string> = {}) =>
  ({ ...forProject(baseStackConfig(), PROJECT), ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`${PROJECT}:${k}`, v])) });

/**
 * The background-work platform (ADR-0150), built by the whole program: Hatchet
 * from the `hatchet-ha` chart on its own CloudNativePG cluster and a three-node
 * RabbitMQ from the RabbitMQ Cluster Operator, the worker
 * token copied into the app namespace, every tier that starts or runs a run
 * wired to it, and the namespace's network policies.
 *
 * What goes wrong here plans clean: a chart value the chart does not read, a
 * replica count of one with a PDB that blocks every drain, the chart's bundled
 * Bitnami RabbitMQ pulled in by default, a queue URL nobody can expand, a tier
 * missing the token, a network rule that admits nobody.
 */

type Resource = { type: string; name: string; inputs: Record<string, any> };
const RESOURCES: Resource[] = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}-id`, state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } } };
    },
    call: () => ({}),
  },
  PROJECT,
  "test",
  false,
);

const SECRET_SIGNATURE = "4dabf18193072939515e22adb298388d"; // pragma: allowlist secret (Pulumi's public secret marker)

/** Unwrap Pulumi's secret envelopes anywhere in a mock input. */
function plain(value: any): any {
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    if (value[SECRET_SIGNATURE]) return plain(value.value);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

function find(type: string, name: string): Resource {
  const hit = RESOURCES.find((r) => r.type === type && r.name === name);
  if (!hit) throw new Error(`no ${type} named "${name}"`);
  return { ...hit, inputs: plain(hit.inputs) };
}

/** The chart's `hatchet-api` Service, `service.externalPort` 8080 (`charts/hatchet-api/values.yaml`). */
const IN_CLUSTER_API = "http://hatchet-api.background-work.svc.cluster.local:8080";

const RELEASE = "kubernetes:helm.sh/v3:Release";
const CLUSTER = "kubernetes:postgresql.cnpg.io/v1:Cluster";
const NETPOL = "kubernetes:networking.k8s.io/v1:NetworkPolicy";
const DEPLOYMENT = "kubernetes:apps/v1:Deployment";
const STATEFULSET = "kubernetes:apps/v1:StatefulSet";
const SECRET = "kubernetes:core/v1:Secret"; // pragma: allowlist secret (a Pulumi resource type)
const JOB = "kubernetes:batch/v1:Job";

type Env = { name: string; value?: string; valueFrom?: any };
function env(type: string, name: string): Env[] {
  return find(type, name).inputs.spec.template.spec.containers[0].env;
}

beforeAll(async () => {
  pulumi.runtime.setAllConfig(stackConfig({ observabilityEnabled: "false", chatAffinity: "false" }));
  const stack = (await import("./index")) as Record<string, unknown>;
  await Promise.all(
    Object.values(stack)
      .filter((v): v is pulumi.Output<unknown> => pulumi.Output.isInstance(v))
      .map((output) => new Promise((resolve) => output.apply(resolve))),
  );
}, 120_000);

describe("background-work-pg", () => {
  it("is a second cluster built by the shared builder: two instances, database and role `hatchet`, about 2 CPU / 4Gi", () => {
    const { metadata, spec } = find(CLUSTER, "background-work-pg").inputs;
    expect(metadata).toMatchObject({ name: "background-work-pg", namespace: "background-work" });
    expect(spec.instances).toBe(2);
    expect(spec.bootstrap.initdb).toMatchObject({ database: "hatchet", owner: "hatchet" });
    expect(spec.resources.limits).toEqual({ cpu: "2", memory: "4Gi" });
    expect(spec.storage.size).toBe("20Gi");
    expect(spec.enableSuperuserAccess).toBe(false);
    // The same placement and keepalives as the app cluster: one builder.
    const app = find(CLUSTER, "pg").inputs.spec;
    expect(spec.affinity).toEqual(app.affinity);
    expect(spec.imageName).toBe(app.imageName);
    expect(spec.postgresql.parameters.tcp_keepalives_idle).toBe(app.postgresql.parameters.tcp_keepalives_idle);
    // No archive unless it is configured, and then off-cluster.
    expect(spec).not.toHaveProperty("backup");
  });

  it("caps the owner by the budget and keeps the scaler read-only and small", async () => {
    const { backgroundWorkPgConnectionBudget } = await import("./src/config/pg-connection-budget");
    const budget = backgroundWorkPgConnectionBudget();
    const roles = Object.fromEntries(
      find(CLUSTER, "background-work-pg").inputs.spec.managed.roles.map((r: any) => [r.name, r]),
    );
    expect(roles.hatchet.connectionLimit).toBe(budget.hatchetRole);
    expect(roles.keda_scaler.connectionLimit).toBe(8);
    for (const role of Object.values(roles) as any[]) {
      expect(role).toMatchObject({ login: true, superuser: false, createdb: false, createrole: false, bypassrls: false });
    }
    // 12 processes in a rolling update (8 + one surge each) and two bootstrap Jobs, at 15 each:
    // with RabbitMQ as the queue, no process opens the Postgres pub/sub pool.
    expect(budget.hatchetRole).toBe(14 * 15);
    expect(budget.total).toBeLessThanOrEqual(budget.limit);
    expect(find(CLUSTER, "background-work-pg").inputs.spec.postgresql.parameters.max_connections).toBe(String(budget.limit));
  });

  it("refuses an archive without an off-cluster endpoint", async () => {
    pulumi.runtime.setAllConfig(stackConfig({ backgroundWorkPgBackupsEnabled: "true" }));
    const { loadConfig } = await import("./src/config");
    expect(() => loadConfig()).toThrow(/backgroundWorkPgBackupEndpoint is unset/);
    pulumi.runtime.setAllConfig(stackConfig());
  });
});

describe("the hatchet-ha release", () => {
  const values = () => find(RELEASE, "hatchet").inputs.values;

  it("is pinned, in its own namespace, under the release name the chart's Caddyfile assumes", () => {
    const release = find(RELEASE, "hatchet").inputs;
    expect(release).toMatchObject({
      name: "hatchet",
      chart: "hatchet-ha",
      version: "0.21.0",
      namespace: "background-work",
      repositoryOpts: { repo: "https://hatchet-dev.github.io/hatchet-charts" },
      waitForJobs: true,
    });
    expect(values().sharedConfig.image.tag).toBe("v0.114.2");
  });

  it("keeps the dashboard's URL on localhost, which no client dials: each is given the in-cluster API", async () => {
    // `serverUrl` is what the dashboard's links and cookie name, behind the
    // port-forward, and what the engine stamps into every token as `server_url`.
    expect(values().sharedConfig.serverUrl).toBe("http://localhost:8080");
    const { HATCHET_API_URL } = await import("./src/platform/hatchet");
    expect(HATCHET_API_URL).toBe(IN_CLUSTER_API);
  });

  it("runs two replicas of each backend component, with a PDB, spread across nodes and explicit resources", () => {
    for (const key of ["api", "grpc", "controllers", "scheduler"]) {
      const c = values()[key];
      expect(c.replicaCount, key).toBe(2);
      expect(c.podDisruptionBudget, key).toEqual({ maxUnavailable: 1 });
      expect(c.nameOverride, key).toBe(`hatchet-${key}`);
      expect(c.affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].podAffinityTerm, key).toEqual({
        topologyKey: "kubernetes.io/hostname",
        labelSelector: { matchLabels: { "app.kubernetes.io/name": `hatchet-${key}` } },
      });
      expect(c.resources.requests.memory, key).toBe(c.resources.limits.memory);
      expect(c.ingress, key).toEqual({ enabled: false });
      // The chart's list is replaced, so the shared config is named again.
      expect(c.envFrom, key).toEqual([
        { secretRef: { name: "hatchet-shared-config" } },
        { secretRef: { name: "hatchet-database" } },
        { prefix: "RABBITMQ_", secretRef: { name: "hatchet-rabbitmq-default-user" } },
      ]);
      // Expanded by the kubelet from the operator's Secret, read just above.
      expect(c.env, key).toMatchObject({
        SERVER_MSGQUEUE_KIND: "rabbitmq",
        SERVER_MSGQUEUE_RABBITMQ_URL:
          "amqp://$(RABBITMQ_username):$(RABBITMQ_password)@hatchet-rabbitmq.background-work.svc.cluster.local:5672/",
      });
    }
  });

  it("queues in the operator's RabbitMQ, never the bundled one, keeps runs 14 days, and bounds the pool the budget counts", () => {
    const { sharedConfig, rabbitmq, postgres } = values();
    expect(rabbitmq).toEqual({ enabled: false });
    expect(postgres).toEqual({ enabled: false });
    expect(sharedConfig.env).toEqual({
      SERVER_LIMITS_DEFAULT_TENANT_RETENTION_PERIOD: "336h",
      DATABASE_MAX_CONNS: "15",
      SERVER_ALLOW_SIGNUP: "false",
    });
    expect(sharedConfig.grpcBroadcastAddress).toBe("hatchet-grpc.background-work.svc.cluster.local:7070");
    // Not the chart's default login.
    expect(sharedConfig.defaultAdminPassword).not.toBe("Admin123!!");
    expect(sharedConfig.defaultAdminPassword).toMatch(/Aa1$/);
  });

  it("takes its database URL from the new cluster, as the owner, over TLS", () => {
    const secret = find(SECRET, "hatchet-database").inputs;
    expect(secret.metadata).toEqual({ name: "hatchet-database", namespace: "background-work" });
    expect(secret.stringData.DATABASE_URL).toMatch(
      /^postgresql:\/\/hatchet:[^@]+@background-work-pg-rw\.background-work\.svc\.cluster\.local:5432\/hatchet\?sslmode=require$/,
    );
  });

  it("exposes the engine's metrics to the node agents and the dashboard to nobody", () => {
    for (const key of ["grpc", "controllers", "scheduler"]) {
      const c = values()[key];
      expect(c.env, key).toMatchObject({ SERVER_PROMETHEUS_ENABLED: "true", SERVER_PROMETHEUS_ADDRESS: ":9090" });
      expect(c.podAnnotations["prometheus.io/port"], key).toBe("9090");
      expect(c.deployment.extraPorts, key).toEqual([{ containerPort: 9090, name: "metrics", protocol: "TCP" }]);
    }
    expect(values().caddy).toEqual({ enabled: true, service: { type: "ClusterIP" } });
    expect(values().frontend.ingress).toEqual({ enabled: false });
    expect(RESOURCES.filter((r) => r.type.includes("HTTPRoute") && JSON.stringify(r.inputs).includes("hatchet"))).toEqual([]);
  });

  it("runs in a namespace that admits the chart's SYS_PTRACE Jobs and still warns on baseline", () => {
    const ns = find("kubernetes:core/v1:Namespace", "background-work-ns").inputs.metadata;
    expect(ns.labels).toMatchObject({
      "pod-security.kubernetes.io/enforce": "privileged",
      "pod-security.kubernetes.io/warn": "baseline",
    });
  });
});

describe("RabbitMQ", () => {
  it("comes from the official operator's release manifest, pinned, after cert-manager", async () => {
    const { RABBITMQ_OPERATOR_VERSION } = await import("./src/platform/rabbitmq");
    const op = RESOURCES.find((r) => r.type === "kubernetes:yaml/v2:ConfigFile" && r.name === "rabbitmq-cluster-operator");
    expect(op?.inputs.file).toBe(
      `https://github.com/rabbitmq/cluster-operator/releases/download/v${RABBITMQ_OPERATOR_VERSION}/cluster-operator.yml`,
    );
    expect(RABBITMQ_OPERATOR_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(read("index.ts")).toMatch(/installRabbitmqOperator\(provider, \[certManager\.release\]\)/);
    // Never the chart's Bitnami subchart.
    expect(find(RELEASE, "hatchet").inputs.values.rabbitmq).toEqual({ enabled: false });
  });

  it("is three nodes with explicit resources and a volume each, spread across hosts, with a PDB", () => {
    const { metadata, spec } = find("kubernetes:rabbitmq.com/v1beta1:RabbitmqCluster", "hatchet-rabbitmq").inputs;
    expect(metadata).toEqual({ name: "hatchet-rabbitmq", namespace: "background-work" });
    expect(spec.replicas).toBe(3);
    expect(spec.resources).toEqual({ requests: { cpu: "500m", memory: "512Mi" }, limits: { cpu: "1", memory: "512Mi" } });
    expect(spec.persistence).toEqual({ storageClassName: "premium", storage: "10Gi" });
    const label = { "background-work/component": "rabbitmq" };
    expect(spec.affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].podAffinityTerm).toEqual({
      topologyKey: "kubernetes.io/hostname",
      labelSelector: { matchLabels: label },
    });
    expect(spec.override.statefulSet.spec.template.metadata.labels).toEqual(label);
    expect(spec.override.statefulSet.spec.template.metadata.annotations["prometheus.io/port"]).toBe("15692");
    const pdb = find("kubernetes:policy/v1:PodDisruptionBudget", "hatchet-rabbitmq-pdb").inputs.spec;
    expect(pdb).toEqual({ maxUnavailable: 1, selector: { matchLabels: label } });
  });

  it("is reached by Hatchet's four components alone, its peers, and the operator's management calls", () => {
    const policy = (name: string) => find(NETPOL, `background-work-${name}`).inputs.spec;
    const intra = policy("allow-same-namespace").podSelector;
    expect(intra).toEqual({ matchExpressions: [{ key: "background-work/component", operator: "NotIn", values: ["rabbitmq"] }] });
    const amqp = policy("allow-hatchet-to-rabbitmq").ingress[0];
    expect(amqp.ports).toEqual([{ protocol: "TCP", port: 5672 }]);
    expect(amqp.from.map((f: any) => f.podSelector.matchLabels["app.kubernetes.io/name"])).toEqual([
      "hatchet-api",
      "hatchet-grpc",
      "hatchet-controllers",
      "hatchet-scheduler",
    ]);
    expect(policy("allow-rabbitmq-operator").ingress[0]).toEqual({
      from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "rabbitmq-system" } } }],
      ports: [{ protocol: "TCP", port: 15672 }],
    });
    expect(policy("rabbitmq-peers").ingress[0].ports.map((p: any) => p.port)).toEqual([5672, 4369, 25672, 15672]);
  });

  it("alerts on queue depth, an unavailable node and Hatchet's scheduling lag", async () => {
    const { backgroundWorkAlertRules } = await import("./src/platform/background-work-alerts");
    const rules = backgroundWorkAlertRules();
    expect(rules).toContain("alert: RabbitmqNodeUnavailable");
    expect(rules).toContain('kube_statefulset_status_replicas_ready{namespace=\\"background-work\\",statefulset=\\"hatchet-rabbitmq-server\\"} < 3');
    expect(rules).toContain("alert: RabbitmqQueueDepth");
    expect(rules).toContain("rabbitmq_queue_messages_ready");
    expect(rules).toContain("alert: HatchetSchedulingLag");
    const cm = find("kubernetes:core/v1:ConfigMap", "background-work-alert-rules").inputs;
    expect(cm.data["background-work.rules.yaml"]).toBe(rules);
  });
});

describe("the worker token", () => {
  it("is copied from the chart's Secret into the app namespace by a Job allowed exactly those two Secrets", () => {
    const read = find("kubernetes:rbac.authorization.k8s.io/v1:Role", "hatchet-token-sync-read").inputs;
    const write = find("kubernetes:rbac.authorization.k8s.io/v1:Role", "hatchet-token-sync-write").inputs;
    expect(read.metadata.namespace).toBe("background-work");
    expect(read.rules).toEqual([{ apiGroups: [""], resources: ["secrets"], resourceNames: ["hatchet-client-config"], verbs: ["get"] }]);
    expect(write.metadata.namespace).toBe(APP_NAMESPACE);
    expect(write.rules).toEqual([{ apiGroups: [""], resources: ["secrets"], resourceNames: ["hatchet-client-token"], verbs: ["get", "patch"] }]);
    const script: string = find(JOB, "hatchet-token-sync").inputs.spec.template.spec.containers[0].args[0];
    expect(script).toContain("/api/v1/namespaces/background-work/secrets/hatchet-client-config");
    expect(script).toContain(`/api/v1/namespaces/${APP_NAMESPACE}/secrets/hatchet-client-token`);
    expect(script).toContain('\\"HATCHET_CLIENT_TOKEN\\"');
  });

  it("reaches every tier that starts or runs a Hatchet run, with the SDK's own variables", () => {
    const tiers: Array<[string, string]> = [
      [DEPLOYMENT, "ingest-worker"],
      [DEPLOYMENT, "agent-worker"],
      [DEPLOYMENT, "bff-jobs"],
      [DEPLOYMENT, "frontend"],
      [DEPLOYMENT, "aiq-api"],
      [STATEFULSET, "aiq-agent"],
    ];
    for (const [type, name] of tiers) {
      const byName = Object.fromEntries(env(type, name).map((e) => [e.name, e]));
      expect(byName.HATCHET_CLIENT_TOKEN?.valueFrom, name).toEqual({
        secretKeyRef: { name: "hatchet-client-token", key: "HATCHET_CLIENT_TOKEN", optional: true },
      });
      expect(byName.HATCHET_CLIENT_HOST_PORT?.value, name).toBe("hatchet-grpc.background-work.svc.cluster.local:7070");
      expect(byName.HATCHET_CLIENT_TLS_STRATEGY?.value, name).toBe("none");
      expect(byName.HATCHET_CLIENT_NAMESPACE?.value, name).toBe("test");
      // The REST API (scheduled runs, crons, cancels, pauses) under both SDKs'
      // names: without them each falls back to the token's `server_url`, the
      // port-forwarded dashboard on localhost, and every such call fails.
      expect(byName.HATCHET_CLIENT_SERVER_URL?.value, name).toBe(IN_CLUSTER_API);
      expect(byName.HATCHET_CLIENT_API_URL?.value, name).toBe(IN_CLUSTER_API);
      // No dual path: the orchestrator flags are gone.
      expect(Object.keys(byName).filter((k) => k.endsWith("_ORCHESTRATOR")), name).toEqual([]);
    }
  });
});

describe("Compose's Hatchet clients", () => {
  it("call the lite engine's API by its service name, not the token's localhost", () => {
    type Service = { environment?: Record<string, string> | string[] };
    const { services } = load(read("../compose/docker-compose.yaml")) as { services: Record<string, Service> };
    const envOf = (service: Service): Record<string, string> =>
      Array.isArray(service.environment)
        ? Object.fromEntries(service.environment.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]))
        : // js-yaml 5 leaves a merge key (`<<: *backend-environment`) unresolved.
          (({ "<<": merged, ...own }: Record<string, any>) => ({ ...merged, ...own }))(service.environment ?? {});
    for (const name of ["chat", "api", "agent-worker", "ingest-worker", "frontend", "bff-jobs"]) {
      const env = envOf(services[name]);
      for (const key of ["HATCHET_CLIENT_SERVER_URL", "HATCHET_CLIENT_API_URL"]) {
        expect(env[key], `${name} ${key}`).toBe(`\${${key}:-http://hatchet-lite:8888}`);
      }
    }
    expect(services["hatchet-lite"]).toMatchObject({ ports: expect.arrayContaining(["8888:8888"]) });
  });
});

describe("the background-work network policies", () => {
  const policy = (name: string) => find(NETPOL, `background-work-${name}`).inputs;

  it("deny by default and admit the calling tiers, and only them, to the gRPC engine and the API", async () => {
    const { HATCHET_CALLERS } = await import("./src/platform/hatchet-network-policies");
    expect(policy("default-deny-ingress").spec).toEqual({ podSelector: {}, policyTypes: ["Ingress"] });
    for (const [name, component, port] of [
      ["allow-app-to-hatchet-grpc", "hatchet-grpc", 7070],
      ["allow-app-to-hatchet-api", "hatchet-api", 8080],
    ] as const) {
      const { metadata, spec } = policy(name);
      expect(metadata.namespace).toBe("background-work");
      expect(spec.podSelector).toEqual({ matchLabels: { "app.kubernetes.io/name": component } });
      expect(spec.ingress[0].ports).toEqual([{ protocol: "TCP", port }]);
      const callers = spec.ingress[0].from.map((f: any) => f.podSelector.matchLabels["app.kubernetes.io/name"]);
      expect(callers).toEqual([...HATCHET_CALLERS]);
      for (const f of spec.ingress[0].from) expect(f.namespaceSelector.matchLabels["kubernetes.io/metadata.name"]).toBe(APP_NAMESPACE);
    }
    expect(HATCHET_CALLERS).toEqual(expect.arrayContaining(["ingest-worker", "agent-worker", "bff-jobs", "frontend", "aiq-api", "aiq-agent"]));
  });

  it("admit to the API every app workload that is told to call it", () => {
    const admitted = new Set(
      policy("allow-app-to-hatchet-api").spec.ingress[0].from.map((f: any) => f.podSelector.matchLabels["app.kubernetes.io/name"]),
    );
    const callers = RESOURCES.filter((r) => r.type === DEPLOYMENT || r.type === STATEFULSET)
      .map((r) => find(r.type, r.name).inputs)
      .filter((inputs) => inputs.metadata?.namespace === APP_NAMESPACE)
      .filter((inputs) =>
        (inputs.spec.template.spec.containers as Array<{ env?: Env[] }>).some((c) =>
          (c.env ?? []).some((e) => e.name === "HATCHET_CLIENT_API_URL"),
        ),
      )
      .map((inputs) => inputs.spec.template.metadata.labels["app.kubernetes.io/name"]);
    expect(callers.length).toBeGreaterThanOrEqual(6);
    expect(callers.filter((name) => !admitted.has(name))).toEqual([]);
  });

  it("admit the CloudNativePG operator and KEDA's operator to the cluster", () => {
    expect(policy("allow-cnpg-operator").spec.ingress).toEqual([
      { from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "cnpg-system" } } }] },
    ]);
    expect(policy("allow-keda-to-postgres").spec.podSelector).toEqual({ matchLabels: { "cnpg.io/cluster": "background-work-pg" } });
  });
});
