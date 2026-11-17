import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "./src/test-support/stack-config";

type Container = { env?: Array<{ name: string; value?: string }> };
type PodSpec = { spec: { containers: Container[] } };
type Manifest = { spec?: { concurrencyPolicy?: string; template?: PodSpec; jobTemplate?: { spec: { template: PodSpec } } } };

const RESOURCES: Array<{ type: string; name: string; inputs: Manifest }> = [];
let STACK: Record<string, unknown> = {};

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

describe("the program constructs in the split topology", () => {
  beforeAll(async () => {
    pulumi.runtime.setAllConfig({
      ...baseStackConfig(),
      "grid-oib:seaweedfsTopology": "split",
      "grid-oib:seaweedfsFilerStore": "postgres",
      "grid-oib:seaweedfsPerOrgBuckets": "true",
      "grid-oib:pgBackupsEnabled": "true",
      "grid-oib:observabilityEnabled": "false",
    });
    const stack = (await import("./index")) as Record<string, unknown>;
    STACK = stack;
    await Promise.all(
      Object.values(stack)
        .filter((v): v is pulumi.Output<unknown> => pulumi.Output.isInstance(v))
        .map((output) => new Promise((resolve) => output.apply(resolve))),
    );
  }, 120_000);

  function named(type: string): string[] {
    return RESOURCES.filter((r) => r.type === type).map((r) => r.name);
  }

  it("creates all three SeaweedFS workloads", () => {
    expect(named("kubernetes:apps/v1:StatefulSet")).toEqual(
      expect.arrayContaining(["seaweedfs-master", "seaweedfs-volume", "seaweedfs-filer"]),
    );
  });

  it("creates the filer's Postgres database and the nightly base backup", () => {
    expect(named("kubernetes:postgresql.cnpg.io/v1:Database")).toEqual(["pg-seaweedfs-filer-db"]);
    expect(named("kubernetes:postgresql.cnpg.io/v1:ScheduledBackup")).toEqual([
      "pg-scheduled-backup",
    ]);
  });

  it("schedules both internal sweeps as CronJobs by default", () => {
    expect(named("kubernetes:batch/v1:CronJob")).toEqual(
      expect.arrayContaining(["storage-alerts", "vector-reconcile"]),
    );
  });

  it("schedules the backend's housekeeping as CronJobs, the only thing that runs it", () => {
    const cronJobs = RESOURCES.filter((r) => r.type === "kubernetes:batch/v1:CronJob");
    const housekeeping = cronJobs.filter((r) => r.name.startsWith("housekeeping-"));
    expect(housekeeping.map((r) => r.name).sort()).toEqual([
      "housekeeping-base-corpus",
      "housekeeping-chat-checkpoints",
      "housekeeping-ghost-jobs",
      "housekeeping-job-events",
    ]);
    for (const job of housekeeping) {
      const container = job.inputs.spec?.jobTemplate?.spec.template.spec.containers[0];
      const url = container?.env?.find((e) => e.name === "SWEEP_URL")?.value;
      expect(url).toBe(`http://api:8000/v1/maintenance/housekeeping/${job.name.replace("housekeeping-", "")}`);
      expect(job.inputs.spec?.concurrencyPolicy).toBe("Forbid");
    }
    const baseCorpus = housekeeping.find((r) => r.name === "housekeeping-base-corpus");
    expect((baseCorpus?.inputs.spec as { suspend?: boolean }).suspend).toBe(false);
    const reconcile = cronJobs.find((r) => r.name === "vector-reconcile");
    expect((reconcile?.inputs.spec as { suspend?: boolean }).suspend).toBe(false);
  });

  it("keeps no files on the web role: no volume claim, nothing mounted at /app/data", () => {
    const web = RESOURCES.find((r) => r.type === "kubernetes:apps/v1:StatefulSet" && r.name === "aiq-agent");
    const spec = web?.inputs.spec;
    expect(spec).toBeDefined();
    expect(spec?.volumeClaimTemplates).toBeUndefined();
    expect(spec?.persistentVolumeClaimRetentionPolicy).toBeUndefined();
    const containers = spec?.template?.spec.containers ?? [];
    expect(containers.length).toBeGreaterThan(0);
    for (const container of containers) {
      expect(container.volumeMounts ?? []).toEqual([]);
      const env = container.env ?? [];
      expect(env.find((e) => e.name === "QDRANT_URL")?.value).toBeDefined();
      for (const gone of ["CHROMA_DIR", "OIB_UPLOADS_DIR", "BASE_CORPUS_STORE"]) {
        expect(env.find((e) => e.name === gone)).toBeUndefined();
      }
    }
    expect(spec?.template?.spec.volumes ?? []).toEqual([]);
  });

  it("runs the backend as two roles: the chat StatefulSet and the api Deployment, Service and HPA", () => {
    expect(named("kubernetes:apps/v1:StatefulSet")).toContain("aiq-agent");
    expect(named("kubernetes:apps/v1:Deployment")).toContain("aiq-api");
    expect(named("kubernetes:core/v1:Service")).toEqual(expect.arrayContaining(["aiq-agent", "aiq-api"]));
    expect(named("kubernetes:autoscaling/v2:HorizontalPodAutoscaler")).toContain("aiq-api");

    const role = (type: string, name: string) => {
      const spec = RESOURCES.find((r) => r.type === type && r.name === name)?.inputs.spec;
      const env = spec?.template?.spec.containers[0].env as Array<{ name: string; value?: string }> | undefined;
      return env?.filter((e) => e.name === "PROCESS_ROLE").map((e) => e.value);
    };
    expect(role("kubernetes:apps/v1:StatefulSet", "aiq-agent")).toEqual(["chat"]);
    expect(role("kubernetes:apps/v1:Deployment", "aiq-api")).toEqual(["api"]);
  });

  it("points every caller at chat and api while the legacy tiers drain beside them", () => {
    expect(named("kubernetes:apps/v1:StatefulSet")).toEqual(expect.arrayContaining(["aiq-agent", "chat"]));
    expect(named("kubernetes:apps/v1:Deployment")).toEqual(expect.arrayContaining(["aiq-api", "api"]));

    const envOf = (type: string, name: string) =>
      RESOURCES.find((r) => r.type === type && r.name === name)?.inputs.spec?.template?.spec.containers[0].env;
    const frontend = envOf("kubernetes:apps/v1:Deployment", "frontend") as Array<{ name: string; value?: string }>;
    const valueIn = (name: string) => frontend.find((e) => e.name === name)?.value;
    expect(valueIn("BACKEND_URL")).toBe("http://api:8000");
    expect(valueIn("BACKEND_CHAT_URL")).toBe("http://chat:8000");
    expect(valueIn("BACKEND_POD_WS_TEMPLATE")).toBe("ws://chat-{i}.chat-headless:8000");
    expect(named("kubernetes:keda.sh/v1alpha1:ScaledObject")).not.toContain("aiq-agent");
  });

  it("gives every backend tier the frontend's WorkOS posture, with a client id to validate against", () => {
    const envOf = (type: string, name: string) => {
      const spec = RESOURCES.find((r) => r.type === type && r.name === name)?.inputs.spec;
      return (spec?.template?.spec.containers[0].env ?? []) as Array<{ name: string; value?: string }>;
    };
    const valueIn = (env: Array<{ name: string; value?: string }>, name: string) =>
      env.find((e) => e.name === name)?.value;

    const frontend = envOf("kubernetes:apps/v1:Deployment", "frontend");
    expect(valueIn(frontend, "REQUIRE_AUTH")).toBe("true");
    const tiers = {
      chat: envOf("kubernetes:apps/v1:StatefulSet", "aiq-agent"),
      api: envOf("kubernetes:apps/v1:Deployment", "aiq-api"),
      "agent-worker": envOf("kubernetes:apps/v1:Deployment", "agent-worker"),
      "ingest-worker": envOf("kubernetes:apps/v1:Deployment", "ingest-worker"),
    };
    for (const [tier, env] of Object.entries(tiers)) {
      expect(valueIn(env, "REQUIRE_AUTH"), `${tier} REQUIRE_AUTH`).toBe(valueIn(frontend, "REQUIRE_AUTH"));
      expect(valueIn(env, "WORKOS_CLIENT_ID"), `${tier} WORKOS_CLIENT_ID`).toBe(valueIn(frontend, "WORKOS_CLIENT_ID"));
      expect(valueIn(env, "WORKOS_CLIENT_ID"), `${tier} WORKOS_CLIENT_ID`).toBeTruthy();
    }
  });

  it("gives the frontend the api URL for HTTP and the chat URL for the socket", () => {
    const frontend = RESOURCES.find((r) => r.type === "kubernetes:apps/v1:Deployment" && r.name === "frontend");
    const env = frontend?.inputs.spec?.template?.spec.containers[0].env as Array<{ name: string; value?: string }>;
    const value = (name: string) => env.find((e) => e.name === name)?.value;

    expect(value("BACKEND_URL")).toBe("http://api:8000");
    expect(value("BACKEND_CHAT_URL")).toBe("http://chat:8000");
  });

  it("creates no scheduler: firing schedules and the sweeps are bff-jobs' Hatchet tasks (ADR-0150)", () => {
    const deployments = named("kubernetes:apps/v1:Deployment");
    expect(deployments).not.toContain("skill-scheduler");
    expect(deployments).toContain("bff-jobs");
  });

  it("exports the image refs it deployed, which the staging downgrade guard reads back", () => {
    const tag = pulumi.runtime.allConfig()["grid-oib:imageTag"] ?? "latest";
    expect(STACK.deployedImages).toEqual({
      backend: `ghcr.io/archos-at/grid-oib-backend:${tag}`,
      frontend: `ghcr.io/archos-at/grid-oib-frontend:${tag}`,
      web: `ghcr.io/archos-at/grid-oib-web:${tag}`,
      cms: `ghcr.io/archos-at/cms:${tag}`,
    });
  });

  it("deploys the office converter and fences it by default (ADR-0070)", () => {
    expect(named("kubernetes:apps/v1:Deployment")).toContain("gotenberg");
    expect(named("kubernetes:core/v1:Service")).toContain("gotenberg");
    expect(named("kubernetes:networking.k8s.io/v1:NetworkPolicy")).toContain(
      "gotenberg-frontend-only",
    );
  });

  it("gives no workload a geocoder by default: address search is off until a stack opts in (ADR-0159)", () => {
    expect(named("kubernetes:apps/v1:StatefulSet")).not.toContain("geocoder");
    expect(named("kubernetes:networking.k8s.io/v1:NetworkPolicy")).not.toContain("geocoder-frontend-only");
    const envOf = (name: string) =>
      RESOURCES.find((r) => r.type === "kubernetes:apps/v1:Deployment" && r.name === name)?.inputs.spec?.template?.spec
        .containers[0].env ?? [];
    expect(envOf("frontend").map((e) => e.name)).not.toContain("GEOCODER_URL");
    const jobs = envOf("bff-jobs");
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.map((e) => e.name)).not.toContain("GEOCODER_URL");
    expect(STACK.geocoderUrl).toBe("(none: geocoderUrl is empty)");
  });

  it("leaves the malware scanner off by default, and the frontend without its URL (ADR-0157)", () => {
    expect(named("kubernetes:apps/v1:Deployment")).not.toContain("clamav");
    expect(named("kubernetes:core/v1:ConfigMap")).not.toContain("clamav-config");
    expect(named("kubernetes:networking.k8s.io/v1:NetworkPolicy")).not.toContain("clamav-bff-only");
    for (const name of ["frontend", "bff-jobs"]) {
      const deployment = RESOURCES.find((r) => r.type === "kubernetes:apps/v1:Deployment" && r.name === name);
      const env = deployment?.inputs.spec?.template?.spec.containers[0].env ?? [];
      expect(env.length, name).toBeGreaterThan(0);
      expect(env.map((e) => e.name), name).not.toContain("MALWARE_SCAN_URL");
    }
  });

  type SizedPod = {
    metadata: { labels: Record<string, string> };
    spec: {
      topologySpreadConstraints?: Array<{
        maxSkew: number;
        topologyKey: string;
        whenUnsatisfiable: string;
        labelSelector: { matchLabels: Record<string, string> };
      }>;
      containers: Array<{ name: string; resources: { requests: Record<string, string>; limits: Record<string, string> } }>;
    };
  };
  const podOf = (type: string, name: string): SizedPod => {
    const found = RESOURCES.find((r) => r.type === type && r.name === name);
    expect(found, `${type} ${name}`).toBeDefined();
    return (found!.inputs.spec as unknown as { template: SizedPod }).template;
  };

  it("reserves what an ingest worker holds while it parses, not its idle floor", () => {
    // 2026-10: at a 1536Mi request three workers packed onto one 16 GB node, grew to 4-6 GB each against a 6Gi limit, and the node went NotReady.
    const [container] = podOf("kubernetes:apps/v1:Deployment", "ingest-worker").spec.containers;

    expect(container.resources.requests.memory).toBe("4Gi");
    expect(container.resources.limits.memory).toBe("6Gi");
  });

  it("spreads the ingest workers across nodes, softly, by their own pod labels", () => {
    const pod = podOf("kubernetes:apps/v1:Deployment", "ingest-worker");

    expect(pod.spec.topologySpreadConstraints).toEqual([
      {
        maxSkew: 1,
        topologyKey: "kubernetes.io/hostname",
        whenUnsatisfiable: "ScheduleAnyway",
        labelSelector: { matchLabels: pod.metadata.labels },
      },
    ]);
  });

  it("places nothing on a worker group when the stack sets no nodeGroup knob", () => {
    const withSelector = RESOURCES.filter((r) => JSON.stringify(r.inputs).includes('"nodeSelector"'));

    expect(withSelector.map((r) => r.name)).toEqual([]);
  });

  it("deploys Qdrant on a stack that sets no Qdrant knob, and no Chroma (ADR-0115)", () => {
    expect(RESOURCES.filter((r) => /chroma/i.test(r.name)).map((r) => `${r.type}/${r.name}`)).toEqual([]);
    expect(named("kubernetes:apps/v1:StatefulSet")).toContain("qdrant");
    expect(named("kubernetes:core/v1:Service")).toEqual(expect.arrayContaining(["qdrant", "qdrant-headless"]));
    for (const [type, name] of [
      ["kubernetes:apps/v1:StatefulSet", "aiq-agent"],
      ["kubernetes:apps/v1:Deployment", "aiq-api"],
      ["kubernetes:apps/v1:Deployment", "agent-worker"],
      ["kubernetes:apps/v1:Deployment", "ingest-worker"],
    ]) {
      const env = RESOURCES.find((r) => r.type === type && r.name === name)?.inputs.spec?.template?.spec.containers[0].env;
      const names = (env ?? []).map((e) => e.name);
      expect(names, name).toContain("QDRANT_URL");
      expect(names, name).toContain("QDRANT_API_KEY");
      expect(names.filter((n) => n.startsWith("CHROMA") || n === "VECTOR_BACKEND"), name).toEqual([]);
    }
  });

  it("puts nothing of Qdrant's dashboard at the edge on a stack without the Connect application", () => {
    const gateway = RESOURCES.find((r) => r.name === "grid-gateway");
    const listeners = (gateway?.inputs.spec as unknown as { listeners: Array<{ name: string }> }).listeners;
    expect(listeners.map((l) => l.name)).toEqual(["http", "https-app", "https-s3", "https-web"]);
    expect(RESOURCES.filter((r) => /qdrant-dashboard/.test(r.name)).map((r) => r.name)).toEqual([]);
    expect(named("kubernetes:gateway.networking.k8s.io/v1:HTTPRoute")).not.toContain(
      "grid-qdrant-dashboard-route",
    );
    expect(named("kubernetes:gateway.envoyproxy.io/v1alpha1:SecurityPolicy")).toEqual([]);
    expect(named("kubernetes:networking.k8s.io/v1:NetworkPolicy")).not.toContain("allow-edge-to-qdrant-dashboard");
  });

  it("manages no PersistentVolumeClaim, so removing Chroma cannot delete its volume", () => {
    expect(named("kubernetes:core/v1:PersistentVolumeClaim")).toEqual([]);
  });

  it("leaves project mail off while inboundMailDomain is unset", () => {
    expect(RESOURCES.filter((r) => r.type.startsWith("cloudflare:"))).toEqual([]);
    const frontend = RESOURCES.find(
      (r) => r.type === "kubernetes:apps/v1:Deployment" && r.name === "frontend",
    );
    const spec = frontend?.inputs.spec as {
      template: { spec: { containers: Array<{ env: Array<{ name: string }> }> } };
    };
    const names = spec.template.spec.containers[0].env.map((e) => e.name);
    expect(names).not.toContain("INBOUND_MAIL_DOMAIN");
    expect(names).toContain("INBOUND_MAIL_SIGNING_KEYS");
  });

  it("serves the signed internal routes on a route of their own, mail or not", () => {
    expect(
      RESOURCES.filter((r) => r.inputs.kind === "HTTPRoute").map(
        (r) => (r.inputs.metadata as { name: string }).name,
      ),
    ).toContain("app-signed");
  });

  it("keeps the S3 endpoint on the name the app tier already uses", () => {
    expect(named("kubernetes:core/v1:Service")).toEqual(
      expect.arrayContaining(["seaweedfs", "seaweedfs-master-svc"]),
    );
  });
});
