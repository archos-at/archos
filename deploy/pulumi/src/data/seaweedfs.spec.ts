import { describe, it, expect } from "vitest";
import * as pulumi from "@pulumi/pulumi";

const SECRET_KEYS: Array<{ name: string; keys: string[] }> = [];

const SECRET_SENTINEL = "4dabf18193072939515e22adb298388d"; // pragma: allowlist secret
function unwrapSecret(input: unknown): Record<string, unknown> | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  return SECRET_SENTINEL in record
    ? (record.value as Record<string, unknown>)
    : record;
}

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      if (args.type === "kubernetes:core/v1:Secret") {
        SECRET_KEYS.push({
          name: (args.inputs.metadata as { name?: string } | undefined)?.name ?? args.name,
          keys: Object.keys(unwrapSecret(args.inputs.stringData) ?? {}),
        });
      }
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

function value<T>(output: pulumi.Output<T>): Promise<T> {
  return new Promise((resolve) => output.apply(resolve));
}

type Container = { name: string; args?: string[]; [k: string]: unknown };
type Probe = { httpGet?: { path?: string; port?: number }; tcpSocket?: { port?: number } };

interface ResolvedPodSpec {
  containers: Container[];
  terminationGracePeriodSeconds?: number;
  topologySpreadConstraints?: unknown[];
}
interface ResolvedStatefulSet {
  replicas?: number;
  minReadySeconds?: number;
  updateStrategy?: { type?: string };
  podManagementPolicy?: string;
  serviceName?: string;
  volumeClaimTemplates?: Array<{
    metadata?: { name?: string };
    spec?: { resources?: { requests?: { storage?: string } } };
  }>;
  template: { spec: ResolvedPodSpec };
}

async function statefulSetSpec(ss: {
  spec: pulumi.Output<unknown>;
}): Promise<ResolvedStatefulSet> {
  return (await value(ss.spec)) as ResolvedStatefulSet;
}

function container(spec: ResolvedStatefulSet, name: string): Container {
  const found = spec.template.spec.containers.find((c) => c.name === name);
  if (!found) throw new Error(`no container named ${name}`);
  return found;
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  const base = {
    protectDataResources: false,
    storage: { className: "premium" },
    ingress: { s3Domain: "s3.example.test" },
    seaweedfs: {
      image: "chrislusf/seaweedfs:3.80",
      storageSize: "20Gi",
      bucket: "grid-documents",
      accessKey: "grid",
      secretKey: pulumi.secret("root-secret"), // pragma: allowlist secret
      backendReadAccessKey: "grid-backend-read",
      backendReadSecretKey: pulumi.secret("read-secret"), // pragma: allowlist secret
      perOrgBuckets: false,
      tenantBucketPrefix: "grid-org-",
      tenantAdminAccessKey: "grid-tenant-admin",
      tenantAdminSecretKey: pulumi.secret("admin-secret"), // pragma: allowlist secret
      topology: "split" as const,
      masterReplicas: 1,
      volumeReplicas: 1,
      filerReplicas: 1,
      masterStorageSize: "1Gi",
      volumeSizeLimitMB: 1024,
      volumeMaxCount: 64,
      volumeMinFreeSpace: "2GiB",
      defaultReplication: "000",
      filerStore: "postgres" as const,
      filerDatabase: "seaweedfs_filer",
      filerDatabaseUser: "seaweedfs_filer",
      filerDatabasePassword: pulumi.secret("filer-secret"), // pragma: allowlist secret
      backup: {
        enabled: false,
        endpoint: "",
        bucket: "grid-documents-backup",
        region: "us-east-1",
        accessKey: pulumi.secret(""),
        secretKey: pulumi.secret(""),
        metadataSchedule: "0 3 * * *",
      },
      encryptVolumeData: true,
      singleMemory: { request: "256Mi", limit: "1Gi" },
    },
    langfuse: {
      enabled: false,
      s3AccessKey: "grid-langfuse",
      s3SecretKey: pulumi.secret("langfuse-secret"), // pragma: allowlist secret
    },
    qdrant: {
      snapshots: {
        s3AccessKey: "grid-qdrant",
        s3SecretKey: pulumi.secret("qdrant-secret"), // pragma: allowlist secret
      },
    },
    cms: {
      enabled: false,
      s3AccessKey: "cms",
      s3SecretKey: pulumi.secret("cms-secret"), // pragma: allowlist secret
    },
    nodeGroups: {},
  };
  return {
    ...base,
    seaweedfs: { ...base.seaweedfs, ...(overrides.seaweedfs as object) },
    langfuse: { ...base.langfuse, ...(overrides.langfuse as object) },
    qdrant: { ...base.qdrant, ...(overrides.qdrant as object) },
  } as unknown as import("../config").DeployConfig;
}

let providerSeq = 0;
function nextProvider(k8s: typeof import("@pulumi/kubernetes"), label: string) {
  providerSeq += 1;
  return new k8s.Provider(`test-${label}-${providerSeq}`, {});
}

async function installSplit(overrides: Record<string, unknown> = {}) {
  const k8s = await import("@pulumi/kubernetes");
  const mod = await import("./seaweedfs-split");
  const identities = await import("./seaweedfs-identities");
  const provider = nextProvider(k8s, "split");
  const cfg = makeConfig(overrides);
  const secret = identities.s3ConfigSecret(cfg, provider, "grid", {
    platformBuckets: [cfg.seaweedfs.bucket],
    tenantBucketPrefix: cfg.seaweedfs.tenantBucketPrefix,
    provisioning: cfg.seaweedfs.perOrgBuckets,
  });
  return mod.installSplitSeaweedFS(
    cfg,
    provider,
    "grid",
    secret,
    pulumi.output("checksum"),
    "grid-pg-rw",
    [],
  );
}

async function installSingle(overrides: Record<string, unknown> = {}) {
  const k8s = await import("@pulumi/kubernetes");
  const { installSingleNodeSeaweedFS } = await import("./seaweedfs-single");
  const identities = await import("./seaweedfs-identities");
  const provider = nextProvider(k8s, "single");
  const cfg = makeConfig({ seaweedfs: { topology: "single", ...overrides } });
  const secret = identities.s3ConfigSecret(cfg, provider, "grid", {
    platformBuckets: [cfg.seaweedfs.bucket],
    tenantBucketPrefix: "grid-org-",
    provisioning: false,
  });
  return installSingleNodeSeaweedFS(cfg, provider, "grid", secret, pulumi.output("checksum"));
}

describe("split topology", () => {
  const install = installSplit;

  it("addresses the master separately from the S3 endpoint", async () => {
    const t = await install();
    expect(t.masterAddress).toBe("seaweedfs-master:9333");
    expect(t.filerAddress).toBe("seaweedfs:8888");
  });

  it("keeps the filer on the `seaweedfs` name the app tier and the edge use", async () => {
    const t = await install();
    const meta = (await value(t.service.metadata)) as { name?: string; labels?: Record<string, string> };
    expect(meta.name).toBe("seaweedfs");
    expect(meta.labels?.["app.kubernetes.io/name"]).toBe("seaweedfs");
  });

  it("publishes the gRPC ports weed tooling dials", async () => {
    const t = await install();
    const svc = (await value(t.service.spec)) as { ports?: Array<{ port: number }> };
    const master = (await value(t.masterService.spec)) as { ports?: Array<{ port: number }> };
    expect(svc.ports?.map((p) => p.port).sort((a, b) => a - b)).toEqual([8333, 8888, 18888]);
    expect(master.ports?.map((p) => p.port).sort((a, b) => a - b)).toEqual([9333, 19333]);
  });

  describe("flags", () => {
    it("gives the master a peer list of resolvable per-pod DNS names", async () => {
      const t = await install({ seaweedfs: { masterReplicas: 3 } });
      const spec = await statefulSetSpec(t.workloads[0]);
      const args = container(spec, "master").args!.join(" ");
      expect(args).toContain(
        "-peers=seaweedfs-master-0.seaweedfs-master-peer.grid.svc.cluster.local:9333," +
          "seaweedfs-master-1.seaweedfs-master-peer.grid.svc.cluster.local:9333," +
          "seaweedfs-master-2.seaweedfs-master-peer.grid.svc.cluster.local:9333",
      );
    });

    it("advertises each pod under its own DNS name, never the Service name", async () => {
      const t = await install();
      const master = container(await statefulSetSpec(t.workloads[0]), "master").args!.join(" ");
      const volume = container(await statefulSetSpec(t.workloads[1]), "volume").args!.join(" ");
      const filer = container(await statefulSetSpec(t.workloads[2]), "filer").args!.join(" ");
      expect(master).toContain("-ip=$(POD_NAME).seaweedfs-master-peer.$(POD_NAMESPACE)");
      expect(volume).toContain("-ip=$(POD_NAME).seaweedfs-volume-peer.$(POD_NAMESPACE)");
      expect(filer).toContain("-ip=$(POD_NAME).seaweedfs-filer-peer.$(POD_NAMESPACE)");
    });

    it("supplies the downward-API env those addresses interpolate from", async () => {
      const t = await install();
      for (const [i, name] of [["master"], ["volume"], ["filer"]].entries()) {
        const c = container(await statefulSetSpec(t.workloads[i]), name[0]);
        const env = (c.env as Array<{ name: string }>) ?? [];
        expect(env.map((e) => e.name)).toEqual(
          expect.arrayContaining(["POD_NAME", "POD_NAMESPACE", "NODE_NAME"]),
        );
      }
    });

    it("points the volume server at the master and the filer at the master", async () => {
      const t = await install();
      expect(container(await statefulSetSpec(t.workloads[1]), "volume").args!.join(" ")).toContain(
        "-mserver=seaweedfs-master:9333",
      );
      expect(container(await statefulSetSpec(t.workloads[2]), "filer").args!.join(" ")).toContain(
        "-master=seaweedfs-master:9333",
      );
    });

    it("reports the Kubernetes node as the SeaweedFS rack", async () => {
      const t = await install();
      expect(container(await statefulSetSpec(t.workloads[1]), "volume").args!.join(" ")).toContain(
        "-rack=$(NODE_NAME)",
      );
    });

    it("passes -encryptVolumeData to the FILER, which is what owns the keys", async () => {
      const on = await install();
      const off = await install({ seaweedfs: { encryptVolumeData: false } });
      expect(container(await statefulSetSpec(on.workloads[2]), "filer").args!.join(" ")).toContain(
        "-encryptVolumeData",
      );
      expect(
        container(await statefulSetSpec(off.workloads[2]), "filer").args!.join(" "),
      ).not.toContain("-encryptVolumeData");
      expect(container(await statefulSetSpec(on.workloads[1]), "volume").args!.join(" ")).not.toContain(
        "encryptVolumeData",
      );
    });

    it("gives every filer the same filerGroup", async () => {
      const t = await install({ seaweedfs: { filerReplicas: 3 } });
      expect(container(await statefulSetSpec(t.workloads[2]), "filer").args!.join(" ")).toContain(
        "-filerGroup=grid",
      );
    });
  });

  describe("probes", () => {
    it("never uses a non-self-scoped endpoint for LIVENESS", async () => {
      const t = await install();
      const master = container(await statefulSetSpec(t.workloads[0]), "master");
      const volume = container(await statefulSetSpec(t.workloads[1]), "volume");
      expect((master.livenessProbe as Probe).httpGet).toBeUndefined();
      expect((master.livenessProbe as Probe).tcpSocket?.port).toBe(9333);
      expect((volume.livenessProbe as Probe).httpGet).toBeUndefined();
      expect((volume.livenessProbe as Probe).tcpSocket?.port).toBe(8080);
      expect((volume.readinessProbe as Probe).httpGet?.path).toBe("/healthz");
      expect((master.readinessProbe as Probe).tcpSocket?.port).toBe(9333);
    });

    it("only puts the master's cluster health on readiness once there is a quorum", async () => {
      const solo = await install();
      expect((container(await statefulSetSpec(solo.workloads[0]), "master").readinessProbe as Probe).tcpSocket?.port).toBe(9333);

      const quorum = await install({ seaweedfs: { masterReplicas: 3 } });
      expect(
        (container(await statefulSetSpec(quorum.workloads[0]), "master").readinessProbe as Probe)
          .httpGet?.path,
      ).toBe("/cluster/healthz");
    });

    it("uses the filer's own store round-trip for both of its probes", async () => {
      const t = await install();
      const filer = container(await statefulSetSpec(t.workloads[2]), "filer");
      expect((filer.readinessProbe as Probe).httpGet).toEqual({ path: "/healthz", port: 8888 });
      expect((filer.livenessProbe as Probe).httpGet).toEqual({ path: "/healthz", port: 8888 });
    });
  });

  describe("filer.toml", () => {
    it("tells weed where to find its store config", async () => {
      const t = await install();
      const args = container(await statefulSetSpec(t.workloads[2]), "filer").args!.join(" ");
      expect(args).toContain("-config_dir=/etc/seaweedfs");
      expect(args).toContain("-s3.config=/etc/seaweedfs/s3.json");
    });

    it("mounts the config Secret read-only at that path", async () => {
      const t = await install();
      const spec = await statefulSetSpec(t.workloads[2]);
      const mounts = container(spec, "filer").volumeMounts as Array<{
        mountPath: string;
        readOnly?: boolean;
      }>;
      const config = mounts.find((m) => m.mountPath === "/etc/seaweedfs");
      expect(config?.readOnly).toBe(true);
    });
  });

  it("does not claim the PVC the single-node topology leaves behind", async () => {
    const t = await install();
    const filer = await statefulSetSpec(t.workloads[2]);
    expect(filer.volumeClaimTemplates?.map((v) => v.metadata?.name)).toEqual(["filer-data"]);
    const master = await statefulSetSpec(t.workloads[0]);
    const volume = await statefulSetSpec(t.workloads[1]);
    expect(master.volumeClaimTemplates?.map((v) => v.metadata?.name)).toEqual(["data"]);
    expect(volume.volumeClaimTemplates?.map((v) => v.metadata?.name)).toEqual(["data"]);
  });

  it("sizes each role's disk from its own knob", async () => {
    const t = await installSplit({
      seaweedfs: { masterStorageSize: "1Gi", filerStorageSize: "40Gi", storageSize: "500Gi" },
    });
    const size = async (i: number) =>
      (await statefulSetSpec(t.workloads[i])).volumeClaimTemplates?.[0]?.spec?.resources?.requests
        ?.storage;

    expect(await size(0)).toBe("1Gi");
    expect(await size(1)).toBe("500Gi");
    expect(await size(2)).toBe("40Gi");
  });

  it("mounts BOTH config Secrets at the path the filer reads", async () => {
    const t = await install();
    const spec = await statefulSetSpec(t.workloads[2]);
    const volumes = (spec.template.spec as unknown as {
      volumes: Array<{ name: string; projected?: { sources: Array<{ secret: { name: string } }> } }>;
    }).volumes;
    const config = volumes.find((v) => v.name === "config");
    const mounted = config?.projected?.sources.map((src) => src.secret.name).sort();
    expect(mounted).toEqual(["seaweedfs-filer-config", "seaweedfs-s3-config"]);

    const mounts = container(spec, "filer").volumeMounts as Array<{ name: string; mountPath: string }>;
    expect(mounts.find((m) => m.name === "config")?.mountPath).toBe("/etc/seaweedfs");
  });

  it("projects two Secrets whose keys cannot collide", async () => {
    await install();
    const byName = new Map(
      SECRET_KEYS.filter(
        (s) => s.name === "seaweedfs-filer-config" || s.name === "seaweedfs-s3-config",
      ).map((s) => [s.name, s]),
    );
    const projected = [...byName.values()];
    expect(projected).toHaveLength(2);
    const all = projected.flatMap((s) => s.keys);
    expect(all.sort()).toEqual(["filer.toml", "s3.json"]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("rolls the pods when either config file changes", async () => {
    const t = await install();
    const spec = await statefulSetSpec(t.workloads[2]);
    const annotations = (spec.template as unknown as {
      metadata: { annotations?: Record<string, string> };
    }).metadata.annotations;
    expect(annotations?.["grid.bigls.net/secret-checksum"]).toBeTruthy();
  });

  describe("policy-pack invariants", () => {
    it("holds for every workload", async () => {
      const t = await install({ seaweedfs: { masterReplicas: 3, volumeReplicas: 2, filerReplicas: 2 } });
      for (const workload of t.workloads) {
        const spec = await statefulSetSpec(workload);
        expect(spec.updateStrategy?.type ?? "RollingUpdate").toBe("RollingUpdate");
        expect(spec.minReadySeconds).toBeGreaterThan(0);
        expect(spec.podManagementPolicy).toBeUndefined();
        expect(spec.template.spec.terminationGracePeriodSeconds).toBeGreaterThanOrEqual(5);
        for (const c of spec.template.spec.containers) {
          const r = c.resources as { requests?: Record<string, string>; limits?: Record<string, string> };
          expect(r?.requests?.cpu).toBeTruthy();
          expect(r?.requests?.memory).toBeTruthy();
          expect(r?.limits?.cpu).toBeTruthy();
          expect(r?.limits?.memory).toBeTruthy();
          expect(c.readinessProbe ?? c.livenessProbe).toBeTruthy();
        }
      }
    });

    it("gives a multi-replica tier a disruption budget and a single-replica tier none", async () => {
      expect((await install()).pdbs).toHaveLength(0);
      expect(
        (await install({ seaweedfs: { masterReplicas: 3, volumeReplicas: 2, filerReplicas: 2 } })).pdbs,
      ).toHaveLength(3);
    });
  });
});

describe("single-node topology", () => {
  it("never probes /cluster/healthz outside a master quorum, in either topology", async () => {
    const solo = await installSingle();
    const split = await installSplit();

    const workloads = [...solo.workloads, ...split.workloads];
    for (const workload of workloads) {
      const spec = await statefulSetSpec(workload);
      for (const c of spec.template.spec.containers) {
        for (const probe of [c.readinessProbe, c.livenessProbe]) {
          expect((probe as Probe | undefined)?.httpGet?.path).not.toBe("/cluster/healthz");
        }
      }
    }

    const quorum = await installSplit({ seaweedfs: { masterReplicas: 3 } });
    const master = container(await statefulSetSpec(quorum.workloads[0]), "master");
    expect((master.readinessProbe as Probe).httpGet?.path).toBe("/cluster/healthz");
    expect((master.livenessProbe as Probe).httpGet).toBeUndefined();
  });

  it("reports readiness from the S3 gateway, which is the port every consumer uses", async () => {
    const t = await installSingle();
    const c = container(await statefulSetSpec(t.workloads[0]), "seaweedfs");
    expect((c.readinessProbe as Probe).httpGet).toEqual({ path: "/healthz", port: 8333 });
    expect((c.livenessProbe as Probe).httpGet).toBeUndefined();
    expect((c.livenessProbe as Probe).tcpSocket?.port).toBe(9333);
  });

  it("still answers the master on the S3 host, because it is one process", async () => {
    const t = await installSingle();
    expect(t.masterAddress).toBe("seaweedfs:9333");
    expect(t.filerAddress).toBe("seaweedfs:8888");

    const spec = await statefulSetSpec(t.workloads[0]);
    const args = container(spec, "seaweedfs").args!.join(" ");
    expect(args).toBe(
      "exec weed server -dir=/data -volume.max=64 -s3 " +
        "-s3.config=/etc/seaweedfs/s3.json -s3.port=8333 -metricsPort=9327 -filer.encryptVolumeData",
    );
  });

  it("takes the volume-slot cap from the operator knob, not from a literal", async () => {
    const t = await installSingle({ volumeMaxCount: 128 });
    const spec = await statefulSetSpec(t.workloads[0]);

    expect(container(spec, "seaweedfs").args!.join(" ")).toContain("-volume.max=128");
  });

  it("gives per-org buckets far more slots than the old cap of 8", async () => {
    const t = await installSingle({ perOrgBuckets: true });
    const spec = await statefulSetSpec(t.workloads[0]);
    const args = container(spec, "seaweedfs").args!.join(" ");

    const slots = Number(/-volume\.max=(\d+)/.exec(args)?.[1])
    expect(slots).toBeGreaterThan(8);
  });

  it("keeps the pre-knob memory envelope when a stack sets nothing", async () => {
    const t = await installSingle();
    const c = container(await statefulSetSpec(t.workloads[0]), "seaweedfs");
    const r = c.resources as { requests?: Record<string, string>; limits?: Record<string, string> };
    expect(r.requests).toEqual({ cpu: "100m", memory: "256Mi" });
    expect(r.limits).toEqual({ cpu: "1", memory: "1Gi" });
  });

  it("takes its memory from the stack, leaving CPU alone", async () => {
    const t = await installSingle({ singleMemory: { request: "1Gi", limit: "4Gi" } });
    const c = container(await statefulSetSpec(t.workloads[0]), "seaweedfs");
    const r = c.resources as { requests?: Record<string, string>; limits?: Record<string, string> };
    expect(r.requests).toEqual({ cpu: "100m", memory: "1Gi" });
    expect(r.limits).toEqual({ cpu: "1", memory: "4Gi" });
  });

  it("still does not re-size the volumes a running stack already holds", async () => {
    const t = await installSingle({ volumeSizeLimitMB: 4096 });
    const spec = await statefulSetSpec(t.workloads[0]);

    expect(container(spec, "seaweedfs").args!.join(" ")).not.toContain("volumeSizeLimit");
  });
});

describe("s3 identities", () => {
  async function render(overrides: Record<string, unknown>, tenantPrefix?: string, extraBuckets: string[] = []) {
    const { renderS3Config } = await import("./seaweedfs-identities");
    const cfg = makeConfig(overrides);
    const json = await value(
      renderS3Config(cfg, {
        platformBuckets: ["grid-documents", "grid-pg-backups", ...extraBuckets],
        tenantBucketPrefix: tenantPrefix ?? "grid-org-",
        provisioning: tenantPrefix !== undefined,
      }),
    );
    return JSON.parse(json) as { identities: Array<{ name: string; actions: string[] }> };
  }

  it("never grants a bare action, which SeaweedFS matches against every bucket", async () => {
    const cfg = await render({});
    for (const identity of cfg.identities) {
      for (const action of identity.actions) {
        expect(action).toContain(":");
      }
    }
  });

  it("keeps the agent tier off the Postgres backup bucket", async () => {
    const cfg = await render({});
    const backendRead = cfg.identities.find((i) => i.name === "grid-backend-read")!;
    expect(backendRead.actions).toEqual(["Read:grid-documents", "Read:grid-org-*"]);
    expect(backendRead.actions.join(" ")).not.toContain("grid-pg-backups");
  });

  it("grants the tenant scope even when provisioning is off", async () => {
    const off = await render({});
    const grid = off.identities.find((i) => i.name === "grid")!;
    expect(grid.actions).toContain("Read:grid-org-*");
    expect(grid.actions).toContain("Write:grid-org-*");
    expect(grid.actions).toContain("List:grid-org-*");
  });

  it("gives the object-path identity no bucket lifecycle authority", async () => {
    const cfg = await render({ seaweedfs: { perOrgBuckets: true } }, "grid-org-");
    const grid = cfg.identities.find((i) => i.name === "grid")!;
    expect(grid.actions.some((a) => a.startsWith("Admin"))).toBe(false);
    expect(grid.actions).toContain("Read:grid-org-*");
    expect(grid.actions).toContain("Write:grid-org-*");
  });

  it("confines the lifecycle identity to the tenant prefix", async () => {
    const cfg = await render({ seaweedfs: { perOrgBuckets: true } }, "grid-org-");
    const admin = cfg.identities.find((i) => i.name === "grid-tenant-admin")!;
    expect(admin.actions).toEqual(["Admin:grid-org-*"]);
  });

  it("creates no lifecycle identity at all when per-org buckets are off", async () => {
    const cfg = await render({});
    expect(cfg.identities.map((i) => i.name)).toEqual(["grid", "grid-backend-read", "grid-qdrant"]);
  });

  it("confines the Qdrant identity to the snapshot bucket, and keeps `grid` off it", async () => {
    const cfg = await render({}, undefined, ["qdrant-snapshots"]);
    const qdrant = cfg.identities.find((i) => i.name === "grid-qdrant")!;
    const grid = cfg.identities.find((i) => i.name === "grid")!;

    expect(qdrant.actions.sort()).toEqual([
      "List:qdrant-snapshots",
      "Read:qdrant-snapshots",
      "Tagging:qdrant-snapshots",
      "Write:qdrant-snapshots",
    ]);
    expect(grid.actions.join(" ")).not.toContain("qdrant-snapshots");
  });
});

describe("config checksum", () => {
  async function checksumFor(overrides: Record<string, unknown>): Promise<string> {
    const k8s = await import("@pulumi/kubernetes");
    const { installSeaweedFS } = await import("./seaweedfs");
    const provider = new k8s.Provider(`ck-${JSON.stringify(overrides).length}-${Math.abs(
      JSON.stringify(overrides).split("").reduce((a, c) => a + c.charCodeAt(0), 0),
    )}`, {});
    const t = installSeaweedFS(makeConfig(overrides), provider, "grid", [], "grid-pg-rw", []);
    const spec = await statefulSetSpec(t.workloads[t.workloads.length - 1]);
    const annotations = (spec.template as unknown as {
      metadata: { annotations?: Record<string, string> };
    }).metadata.annotations;
    return annotations!["grid.bigls.net/secret-checksum"];
  }

  it("changes when the S3 secret key is rotated", async () => {
    const before = await checksumFor({});
    const after = await checksumFor({
      seaweedfs: { secretKey: pulumi.secret("rotated-s3") }, // pragma: allowlist secret
    });
    expect(after).not.toBe(before);
  });

  it("changes when the filer's Postgres password is rotated", async () => {
    const before = await checksumFor({});
    const after = await checksumFor({
      seaweedfs: { filerDatabasePassword: pulumi.secret("rotated-pg") }, // pragma: allowlist secret
    });
    expect(after).not.toBe(before);
  });

  it("is stable when nothing changed", async () => {
    expect(await checksumFor({})).toBe(await checksumFor({}));
  });
});

describe("compose stacks match the identity catalogue", () => {
  const COMPOSE_FILES = ["../compose/docker-compose.yaml"];

  async function composeIdentities(relativePath: string) {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(process.cwd(), relativePath), "utf8");

    const match = /printf '(\{"identities".*?\})\\n'/s.exec(source);
    if (!match) throw new Error(`no identity printf found in ${relativePath}`);

    const parsed = JSON.parse(match[1].replace(/%s/g, "placeholder")) as {
      identities: Array<{ name: string; actions: string[] }>;
    };
    return parsed.identities;
  }

  it.each(COMPOSE_FILES)("%s declares the same identities and grants", async (file) => {
    const { s3IdentityCatalog } = await import("./seaweedfs-identities");
    const expected = s3IdentityCatalog({
      documentsBucket: "grid-documents",
      platformBuckets: ["grid-documents"],
      tenantBucketPrefix: "grid-org-",
      provisioning: true,
      langfuseBucket: "langfuse",
    });

    const actual = await composeIdentities(file);

    expect(actual.map((i) => i.name)).toEqual(expected.map((i) => i.name));
    for (const identity of expected) {
      const found = actual.find((i) => i.name === identity.name);
      expect(found?.actions.slice().sort()).toEqual(identity.actions.slice().sort());
    }
  });

  it.each(COMPOSE_FILES)("%s gives every identity a distinct credential", async (file) => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(process.cwd(), file), "utf8");
    const printf = /printf '\{"identities".*?> \/etc\/seaweedfs\/s3\.json/s.exec(source)![0];

    const identities = await composeIdentities(file);
    const expectedVars = identities.length * 2;

    const vars = [...printf.matchAll(/"\$\$([A-Z_]+)"/g)].map((m) => m[1]);
    expect(vars).toHaveLength(expectedVars);
    expect(new Set(vars).size).toBe(expectedVars);
  });

  it.each(COMPOSE_FILES)("%s points the agent tier at the read-only identity", async (file) => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(process.cwd(), file), "utf8");
    const agentBlock = source.slice(
      source.indexOf("  chat:"),
      source.indexOf("SEAWEED_BUCKET", source.indexOf("  chat:")),
    );
    expect(agentBlock).toContain("SEAWEED_READONLY_ACCESS_KEY");
    expect(agentBlock).not.toMatch(/SEAWEED_ACCESS_KEY=\$\{SEAWEED_ACCESS_KEY/);
  });
});
