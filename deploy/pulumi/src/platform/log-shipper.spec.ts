import { beforeAll, describe, expect, it, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig, langfuseStackConfig } from "../test-support/stack-config";
import { parseCollectorConfig, pipeline } from "../test-support/collector";
import type { CollectorConfig } from "./collector-config";
import { LOG_SHIPPER } from "../config/observability";
import { loadConfig } from "../config";

const RESOURCES: Array<{ type: string; name: string; inputs: Record<string, unknown> }> = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}-id`, state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } } };
    },
    call: () => ({}),
  },
  "grid-oib",
  "test",
  false,
);

function resolve<T>(value: unknown): Promise<T> {
  return new Promise((done) => (pulumi.output(value) as pulumi.Output<T>).apply((v) => (done(v), v)));
}

function find(type: string, name: string) {
  const hit = RESOURCES.find((r) => r.type === type && r.name === name);
  if (!hit) throw new Error(`${type} ${name} was not created`);
  return hit;
}

const RBAC = "kubernetes:rbac.authorization.k8s.io/v1";
const READ_ONLY = ["get", "list", "watch"];
const READ_NAMESPACES = ["grid", "background-work", "cms"];

async function deploy(values: Record<string, string>): Promise<void> {
  vi.resetModules();
  RESOURCES.length = 0;
  pulumi.runtime.setAllConfig({ ...baseStackConfig(), ...langfuseStackConfig(), "grid-oib:cmsEnabled": "true", ...values });
  await import("../../index");
  await new Promise((r) => setTimeout(r, 200));
}

async function collectorConfig(name: string): Promise<CollectorConfig> {
  const data = await resolve<Record<string, string>>(find("kubernetes:core/v1:ConfigMap", name).inputs.data);
  return parseCollectorConfig(data["collector.yaml"]);
}

describe("container logs, with PostHog logs on (the default)", () => {
  let shipper: CollectorConfig;
  let pod: any;

  beforeAll(async () => {
    await deploy({});
    shipper = await collectorConfig("otel-logs");
    pod = (await resolve<any>(find("kubernetes:apps/v1:DaemonSet", "otel-logs").inputs.spec)).template.spec;
  }, 120_000);

  it("reads the app namespaces from the constants that name them, and no other", () => {
    const filelog = shipper.receivers["filelog/pods"] as { include: string[]; start_at: string };
    expect(filelog.include).toEqual(READ_NAMESPACES.map((ns) => `/var/log/pods/${ns}_*/*/*.log`));
    expect(filelog.include.join()).not.toMatch(/kube-system|observability|envoy|cnpg-system|keda/);
    expect(filelog.start_at).toBe("end");
  });

  it("skips the collector's own pods, the noisy stores and every OTLP-instrumented container", async () => {
    const { exclude } = shipper.receivers["filelog/pods"] as { exclude: string[] };
    const skipped = exclude.map((glob) => glob.match(/^\/var\/log\/pods\/\*\/([^/]+)\/\*\.log$/)?.[1]);
    expect(skipped).not.toContain(undefined);
    expect(skipped).toContain("collector");
    expect(skipped).toContain("postgres");
    const instrumented = new Set<string>();
    for (const r of RESOURCES) {
      const spec = await resolve<any>(r.inputs?.spec);
      const template = spec?.template?.spec ?? spec?.jobTemplate?.spec?.template?.spec;
      for (const c of template?.containers ?? []) {
        if ((c.env ?? []).some((e: { name: string }) => e.name === "OTEL_EXPORTER_OTLP_ENDPOINT")) instrumented.add(c.name);
      }
    }
    expect(instrumented.size).toBeGreaterThan(0);
    for (const container of instrumented) expect(skipped).toContain(container);
  });

  it("parses CRI lines, stamps the pod's workload, and sends them to the gateway in the app namespace", () => {
    const filelog = shipper.receivers["filelog/pods"] as { operators: Array<{ type: string }>; max_log_size: string };
    expect(filelog.operators).toEqual([{ type: "container", id: "container-parser", add_metadata_from_filepath: true }]);
    expect(filelog.max_log_size).toBe("16KiB");
    expect(shipper.processors.k8sattributes).toMatchObject({
      filter: { node_from_env_var: "K8S_NODE_NAME" },
      extract: { metadata: expect.arrayContaining(["k8s.deployment.name"]) },
    });
    expect(shipper.exporters["otlp_http/gateway"]).toMatchObject({ endpoint: "http://otel-collector.grid.svc:4319" });
    expect(shipper.service.pipelines).toEqual({
      "logs/pods": pipeline(["otlp_http/gateway"], {
        receivers: ["filelog/pods"],
        processors: [
          "transform/pod_logs",
          "filter/drop_debug",
          "probabilistic_sampler/info",
          "transform/drop_sampling_keys",
          "k8sattributes",
        ],
      }),
    });
  });

  it("drops debug, keeps warnings in full and samples info at an explicit rate", () => {
    expect(shipper.processors["filter/drop_debug"]).toEqual({
      error_mode: "ignore",
      log_conditions: ["log.severity_number < SEVERITY_NUMBER_INFO"],
    });
    expect(shipper.processors["probabilistic_sampler/info"]).toMatchObject({
      sampling_percentage: LOG_SHIPPER.infoSamplePercent,
      sampling_priority: "sampling.priority",
    });
    const statements = (shipper.processors["transform/pod_logs"] as any).log_statements.flatMap((s: any) => s.statements);
    expect(statements).toContain(
      'set(log.attributes["sampling.priority"], 100) where log.severity_number >= SEVERITY_NUMBER_WARN',
    );
  });

  it("mounts only the pod log directory, read-only, and holds no PostHog token", async () => {
    const container = pod.containers[0];
    expect(pod.volumes.filter((v: any) => v.hostPath)).toEqual([
      { name: "pod-logs", hostPath: { path: "/var/log/pods", type: "Directory" } },
    ]);
    expect(container.volumeMounts).toContainEqual({ name: "pod-logs", mountPath: "/var/log/pods", readOnly: true });
    const data = await resolve<Record<string, string>>(find("kubernetes:core/v1:ConfigMap", "otel-logs").inputs.data);
    expect(data["collector.yaml"]).not.toContain("phc_");
  });

  it("runs as a non-root user with no capabilities, reading the root-owned files through group 0 alone", () => {
    expect(pod.securityContext).toMatchObject({ runAsNonRoot: true, runAsUser: 10001, supplementalGroups: [0] });
    expect(pod.hostNetwork).toBeUndefined();
    expect(pod.hostPID).toBeUndefined();
    expect(pod.containers[0].securityContext).toEqual({
      allowPrivilegeEscalation: false,
      privileged: false,
      capabilities: { drop: ["ALL"] },
      seccompProfile: { type: "RuntimeDefault" },
      readOnlyRootFilesystem: true,
    });
  });

  it("lives in its own namespace, since the app namespace's baseline admission refuses a hostPath", async () => {
    const meta = await resolve<any>(find("kubernetes:core/v1:Namespace", "observability-ns").inputs.metadata);
    expect(meta.name).toBe(LOG_SHIPPER.namespace);
    expect(meta.labels["pod-security.kubernetes.io/enforce"]).toBe("privileged");
    expect(meta.labels["pod-security.kubernetes.io/warn"]).toBe("baseline");
    const appNs = RESOURCES.find((r) => r.type === "kubernetes:core/v1:Namespace" && r.name !== "observability-ns" && (r.inputs.metadata as any)?.name === "grid");
    expect((appNs?.inputs.metadata as any).labels["pod-security.kubernetes.io/enforce"]).toBe("baseline");
  });

  it("reads pod metadata only: pods, namespaces and replicasets, nothing it can write", async () => {
    const rules = await resolve<any[]>(find(`${RBAC}:ClusterRole`, "otel-logs").inputs.rules);
    expect(rules).toEqual([
      { apiGroups: [""], resources: ["namespaces", "pods"], verbs: READ_ONLY },
      { apiGroups: ["apps"], resources: ["replicasets"], verbs: READ_ONLY },
    ]);
  });

  it("is let through the app namespace's default-deny to the gateway's OTLP port, and only there", async () => {
    const policy = await resolve<any>(
      find("kubernetes:networking.k8s.io/v1:NetworkPolicy", "allow-log-shipper-to-collector").inputs.spec,
    );
    expect(policy.podSelector).toEqual({ matchLabels: { "app.kubernetes.io/name": "otel-collector" } });
    expect(policy.ingress).toEqual([
      {
        from: [
          {
            namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "observability" } },
            podSelector: { matchLabels: { "app.kubernetes.io/name": "otel-logs" } },
          },
        ],
        ports: [{ protocol: "TCP", port: 4319 }],
      },
    ]);
  });

  it("withholds the gateway from the same-namespace rule, so no app pod can push rows into the shipper port", async () => {
    const intra = await resolve<any>(find("kubernetes:networking.k8s.io/v1:NetworkPolicy", "allow-same-namespace").inputs.spec);
    expect(intra.podSelector.matchExpressions[0].values).toContain("otel-collector");
    const rest = await resolve<any>(
      find("kubernetes:networking.k8s.io/v1:NetworkPolicy", "allow-same-namespace-to-collector").inputs.spec,
    );
    expect(rest.podSelector).toEqual({ matchLabels: { "app.kubernetes.io/name": "otel-collector" } });
    expect(rest.ingress).toEqual([
      {
        from: [{ podSelector: {} }],
        ports: [4317, 4318, 13133, 8889].map((port) => ({ protocol: "TCP", port })),
      },
    ]);
    const toGateway = RESOURCES.filter(
      (r) => r.type === "kubernetes:networking.k8s.io/v1:NetworkPolicy" && JSON.stringify(r.inputs).includes("4319"),
    );
    expect(toGateway.map((r) => r.name)).toEqual(["allow-log-shipper-to-collector"]);
  });
});

describe("Kubernetes events, with PostHog logs on", () => {
  let gateway: CollectorConfig;
  let spec: any;

  beforeAll(async () => {
    await deploy({});
    gateway = await collectorConfig("otel-collector");
    spec = await resolve<any>(find("kubernetes:apps/v1:Deployment", "otel-collector").inputs.spec);
  }, 120_000);

  it("watches events in the app namespaces only, from the gateway", () => {
    expect(gateway.receivers["k8sobjects/events"]).toEqual({
      auth_type: "serviceAccount",
      objects: [{ name: "events", group: "events.k8s.io", mode: "watch", namespaces: READ_NAMESPACES }],
    });
    expect(gateway.service.pipelines["logs/k8s_events"]).toEqual(
      pipeline(["otlp_http/posthog"], {
        receivers: ["k8sobjects/events"],
        processors: ["filter/event_deletions", "transform/k8s_events", "groupbyattrs/k8s_events", "resource/logs_environment"],
      }),
    );
  });

  it("reads them from a single replica, so each event lands once", async () => {
    expect(spec.replicas).toBe(1);
    const scalers = RESOURCES.filter(
      (r) => /HorizontalPodAutoscaler|ScaledObject/.test(r.type) && JSON.stringify(r.inputs).includes("otel-collector"),
    );
    expect(scalers).toEqual([]);
  });

  it("may read events, and nothing else, in each app namespace, through a Role bound to the gateway's account", async () => {
    for (const ns of READ_NAMESPACES) {
      const role = find(`${RBAC}:Role`, `otel-collector-events-${ns}`);
      expect((await resolve<any>(role.inputs.metadata)).namespace).toBe(ns);
      expect(await resolve<any>(role.inputs.rules)).toEqual([
        { apiGroups: ["events.k8s.io"], resources: ["events"], verbs: READ_ONLY },
      ]);
      const binding = find(`${RBAC}:RoleBinding`, `otel-collector-events-${ns}`);
      expect(await resolve<any>(binding.inputs.subjects)).toEqual([
        { kind: "ServiceAccount", name: "otel-collector", namespace: "grid" },
      ]);
    }
    const roles = RESOURCES.filter((r) => r.type === `${RBAC}:Role` && r.name.startsWith("otel-collector-events-"));
    expect(roles.map((r) => r.name).sort()).toEqual(READ_NAMESPACES.map((ns) => `otel-collector-events-${ns}`).sort());
    expect(spec.template.spec.serviceAccountName).toBe("otel-collector");
  });

  it("takes the shipper's lines on a port of their own, so no SDK can claim to be the shipper", async () => {
    expect(gateway.receivers["otlp/shipper"]).toEqual({ protocols: { http: { endpoint: "0.0.0.0:4319" } } });
    expect(gateway.service.pipelines["logs/containers"]).toEqual(
      pipeline(["otlp_http/posthog"], {
        receivers: ["otlp/shipper"],
        processors: ["resource/container_source", "resource/logs_environment"],
      }),
    );
    expect(gateway.service.pipelines["logs/posthog"].receivers).toEqual(["otlp"]);
    const service = await resolve<any>(find("kubernetes:core/v1:Service", "otel-collector").inputs.spec);
    expect(service.ports).toContainEqual({ port: 4319, targetPort: 4319, name: "otlp-shipper" });
  });
});

describe("with PostHog logs off", () => {
  it("deploys no log shipper, no events receiver and no event Roles", async () => {
    await deploy({ "grid-oib:posthogLogsEnabled": "false" });
    expect(RESOURCES.some((r) => r.name === "otel-logs" || r.name === "observability-ns")).toBe(false);
    expect(RESOURCES.some((r) => r.type === `${RBAC}:Role` && r.name.startsWith("otel-collector-events-"))).toBe(false);
    expect((await collectorConfig("otel-collector")).receivers).not.toHaveProperty("k8sobjects/events");
  }, 120_000);
});

describe("an app namespace named like the shipper's", () => {
  it("is refused when the config is read, before any Namespace is registered", () => {
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), "grid-oib:namespace": "observability" });
    expect(() => loadConfig()).toThrow(/must not be "observability"/);
  });
});
