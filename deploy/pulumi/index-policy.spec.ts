import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { LEGACY_PROJECT } from "./src/names";
import { SIGNING_KEYS } from "./src/test-support/app-zone-config";
import { baseStackConfig } from "./src/test-support/stack-config";

type Resource = { type: string; name: string; inputs: Record<string, any> };

const ZONE_NAMES: Record<string, string> = {
  "66de14f8d07a729634f5d230418bb907": "piloti.at", // pragma: allowlist secret (public zone id)
  "31df51fbdd7ea2d7ef63bcaab9a09559": "archos.tech", // pragma: allowlist secret (public zone id)
};
const RESOURCES: Resource[] = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}-id`, state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } } };
    },
    call: (args: pulumi.runtime.MockCallArgs) => {
      if (args.token === "cloudflare:index/getZone:getZone") {
        return { id: args.inputs.zoneId, name: ZONE_NAMES[args.inputs.zoneId as string], account: { id: "account-1", name: "Office" } };
      }
      if (args.token === "cloudflare:index/getDnsRecords:getDnsRecords") {
        return { results: [{ name: args.inputs.name?.exact ?? "", content: "route1.mx.cloudflare.net", type: "MX" }] };
      }
      return {};
    },
  },
  LEGACY_PROJECT,
  "dev",
  false,
);

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
    [`${LEGACY_PROJECT}:registryPassword`]: "placeholder-secret-value",
    [`${LEGACY_PROJECT}:otelOidcClientSecret`]: "placeholder-secret-value",
    [`${LEGACY_PROJECT}:cloudflareApiToken`]: "placeholder-secret-value",
    [`${LEGACY_PROJECT}:inboundMailSigningKeys`]: SIGNING_KEYS,
  };
}

type Workload = { kind: string; name: string; spec: Record<string, any> };

const CREATED_WITH_POD_MANAGEMENT_POLICY: Record<string, string> = { qdrant: "Parallel" };

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

  it("exempts only the Deployments of the release manifests it references", () => {
    const exempt = UPSTREAM_SOAK_EXEMPT;
    const referenced = RESOURCES.filter((r) => r.type === "kubernetes:yaml/v2:ConfigFile" && /^https:/.test(r.inputs.file))
      .map((r) => r.name);

    expect(exempt).toEqual(["rabbitmq-cluster-operator"]);
    expect(referenced).toEqual(exempt);
  });
});
