import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { LEGACY_PROJECT } from "./src/names";
import { baseStackConfig } from "./src/test-support/stack-config";

/**
 * The policy pack's mandatory WORKLOAD rules (deploy/pulumi/policy/index.ts),
 * applied to the dev stack's plan before a deploy does.
 *
 * The pack runs only in `pulumi preview --policy-pack`, which needs the stack's
 * credentials, so CI never ran it on a pull request: the first staging preview
 * with the RabbitMQ operator failed on its Deployment (no soak, no deadline, no
 * surge) after the change had merged. This spec reads every Deployment,
 * StatefulSet and DaemonSet the program builds, including the objects a
 * `yaml/v2` ConfigGroup or ConfigFile carries inline, the way the pack sees
 * them. A Helm release is one resource to the pack, so its chart's workloads
 * are not here, as they are not there. A manifest the program references by URL
 * (a `ConfigFile` with `file`) is read by the deploy, not by these mocks; the
 * Deployments in one are exempt by name in the pack (`UPSTREAM_SOAK_EXEMPT`),
 * and the last test keeps that list to the ones we mean.
 *
 * Kept in step with the pack by hand: a rule added there gets its check here.
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
  LEGACY_PROJECT,
  "dev",
  false,
);

/**
 * Pulumi.dev.yaml's config over the suite's base config, which stands in for the
 * secrets the dev stack reads from its ESC environment; a `secure:` value in the
 * file becomes a placeholder.
 */
function devStackConfig(): Record<string, string> {
  const file = load(readFileSync(join(__dirname, "Pulumi.dev.yaml"), "utf8")) as { config: Record<string, unknown> };
  return { ...baseStackConfig(), ...Object.fromEntries(
    Object.entries(file.config).map(([key, value]) => [
      key,
      value && typeof value === "object" && "secure" in value
        ? "placeholder-secret-value"
        : typeof value === "string"
          ? value
          : JSON.stringify(value),
    ]),
  ),
    // In the dev stack's ESC environment, not its file.
    [`${LEGACY_PROJECT}:registryPassword`]: "placeholder-secret-value",
    // The platform Connect application's secret: the gate in front of Langfuse and the CMS.
    [`${LEGACY_PROJECT}:otelOidcClientSecret`]: "placeholder-secret-value",
  };
}

type Workload = { kind: string; name: string; spec: Record<string, any> };

/** The pack's CREATED_WITH_POD_MANAGEMENT_POLICY, the StatefulSets created with the field. */
const CREATED_WITH_POD_MANAGEMENT_POLICY: Record<string, string> = { qdrant: "Parallel" };

/** The pack's UPSTREAM_SOAK_EXEMPT, read from it (the last test). */
const UPSTREAM_SOAK_EXEMPT = (() => {
  const pack = readFileSync(join(__dirname, "policy/index.ts"), "utf8");
  const table = pack.match(/const UPSTREAM_SOAK_EXEMPT[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
  return [...table.matchAll(/^\s*"([a-z0-9-]+)":/gm)].map((m) => m[1]);
})();

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

/** The pack's mandatory checks, one message per violation, as the pack words the rule. */
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
    pulumi.runtime.setAllConfig(devStackConfig());
    await import("./index");
    await new Promise((r) => setTimeout(r, 200));
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

  // The pack exempts an upstream manifest's Deployment from the soak by name. The list holds exactly the manifests the program references by URL.
  it("exempts only the Deployments of the release manifests it references", () => {
    const exempt = UPSTREAM_SOAK_EXEMPT;
    const referenced = RESOURCES.filter((r) => r.type === "kubernetes:yaml/v2:ConfigFile" && /^https:/.test(r.inputs.file))
      .map((r) => r.name);

    expect(exempt).toEqual(["rabbitmq-cluster-operator"]);
    expect(referenced).toEqual(exempt);
  });
});
