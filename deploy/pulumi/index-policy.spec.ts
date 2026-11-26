import { describe, it, expect, beforeAll } from "vitest";
import { UPSTREAM_SOAK_EXEMPT as UPSTREAM_SOAK_EXEMPT_TABLE } from "./policy/exemptions";
import { type PlannedResource, mockDevStack, planDevStack } from "./src/test-support/dev-stack";

type Resource = PlannedResource;

const RESOURCES: Resource[] = mockDevStack();

type Workload = { kind: string; name: string; spec: Record<string, any> };

const CREATED_WITH_POD_MANAGEMENT_POLICY: Record<string, string> = { qdrant: "Parallel" };

const UPSTREAM_SOAK_EXEMPT = Object.keys(UPSTREAM_SOAK_EXEMPT_TABLE);

const WORKLOAD_TYPES: Record<string, string> = {
  "kubernetes:apps/v1:Deployment": "Deployment",
  "kubernetes:apps/v1:StatefulSet": "StatefulSet",
  "kubernetes:apps/v1:DaemonSet": "DaemonSet",
};

function workloads(): Workload[] {
  const direct = RESOURCES.filter((r) => WORKLOAD_TYPES[r.type]).map((r) => ({
    kind: WORKLOAD_TYPES[r.type],
    name: r.inputs.metadata?.name ?? r.name,
    spec: r.inputs.spec ?? {},
  }));
  const fromManifests = RESOURCES.filter((r) => Array.isArray(r.inputs.objs))
    .flatMap((r) => r.inputs.objs as { kind?: string; metadata?: { name?: string }; spec?: Record<string, any> }[])
    .filter((o) => o.kind && ["Deployment", "StatefulSet", "DaemonSet"].includes(o.kind))
    .map((o) => ({ kind: o.kind as string, name: o.metadata?.name ?? "<unnamed>", spec: o.spec ?? {} }));
  return [...direct, ...fromManifests];
}

function violations(w: Workload): string[] {
  const out: string[] = [];
  const pod = w.spec.template?.spec ?? {};
  if (w.kind === "Deployment") {
    if (!UPSTREAM_SOAK_EXEMPT.includes(w.name) && !(w.spec.minReadySeconds >= 1)) {
      out.push("deployment-rollout-gated: minReadySeconds");
    }
    const type = w.spec.strategy?.type ?? "RollingUpdate";
    const replicas = w.spec.replicas ?? 2;
    const maxUnavailable = w.spec.strategy?.rollingUpdate?.maxUnavailable;
    if (type === "Recreate") {
      if (replicas > 1) out.push("deployment-no-capacity-dip: Recreate with several replicas");
    } else if (!(replicas === 1 && maxUnavailable === undefined) && String(maxUnavailable) !== "0") {
      out.push("deployment-no-capacity-dip: maxUnavailable is not 0");
    }
  }
  if (w.kind === "StatefulSet") {
    if ((w.spec.updateStrategy?.type ?? "RollingUpdate") !== "RollingUpdate") out.push("statefulset-rollout-gated: OnDelete");
    if (!(w.spec.minReadySeconds >= 1)) out.push("statefulset-rollout-gated: minReadySeconds");
    const policy = w.spec.podManagementPolicy;
    if (policy !== undefined && CREATED_WITH_POD_MANAGEMENT_POLICY[w.name] !== policy) {
      out.push("statefulset-no-immutable-field-writes: podManagementPolicy");
    }
  }
  const grace = pod.terminationGracePeriodSeconds;
  if (grace === undefined || grace < 5) out.push("workload-graceful-termination");
  for (const c of [...(pod.containers ?? []), ...(pod.initContainers ?? [])]) {
    const r = c.resources ?? {};
    if (!r.requests?.cpu || !r.requests?.memory || !r.limits?.cpu || !r.limits?.memory) {
      out.push(`container-resources-bounded: ${c.name}`);
    }
    const tag = String(c.image ?? "").split("/").pop()?.split(":")[1];
    const immutable = String(c.image ?? "").includes("@sha256:") || (tag !== undefined && tag !== "latest");
    if (c.image && !immutable && c.imagePullPolicy !== "Always") out.push(`moving-tag-must-repull: ${c.name}`);
  }
  return out;
}

describe("the dev stack's plan against the policy pack's mandatory workload rules", () => {
  beforeAll(async () => {
    await planDevStack();
  });

  it("builds the workloads", () => {
    expect(workloads().length).toBeGreaterThan(10);
  });

  it("has no workload a mandatory rule refuses", () => {
    const refused = workloads()
      .map((w) => [`${w.kind}/${w.name}`, violations(w)] as const)
      .filter(([, v]) => v.length > 0);

    expect(Object.fromEntries(refused)).toEqual({});
  });

  it("exempts only the Deployments of the release manifests it references", () => {
    const exempt = UPSTREAM_SOAK_EXEMPT;
    const referenced = RESOURCES.filter((r) => r.type === "kubernetes:yaml/v2:ConfigFile" && /^https:/.test(r.inputs.file))
      .map((r) => r.name);

    expect(exempt).toEqual(["rabbitmq-cluster-operator"]);
    expect(referenced).toEqual(exempt);
  });
});
