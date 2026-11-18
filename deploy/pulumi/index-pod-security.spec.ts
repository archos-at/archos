import { describe, it, expect, beforeAll } from "vitest";
import { BROWSER_RENDERER } from "./src/app/browser-renderer";
import { commonLabels } from "./src/platform/namespaces";
import { type PlannedResource, mockDevStack, planDevStack } from "./src/test-support/dev-stack";
import { type PodSecurityLevel, podSecurityLevel, podSecurityViolations } from "./src/test-support/pod-security";

const RESOURCES: PlannedResource[] = mockDevStack();

type Manifest = { kind: string; metadata?: Record<string, any>; spec?: Record<string, any> };
type PlannedPod = { workload: string; namespace: string | undefined; template: Record<string, any> };

const KINDS: Record<string, string> = {
  "kubernetes:apps/v1:Deployment": "Deployment",
  "kubernetes:apps/v1:StatefulSet": "StatefulSet",
  "kubernetes:apps/v1:DaemonSet": "DaemonSet",
  "kubernetes:batch/v1:Job": "Job",
  "kubernetes:batch/v1:CronJob": "CronJob",
  "kubernetes:core/v1:Pod": "Pod",
};

function manifests(): Manifest[] {
  const direct = RESOURCES.filter((r) => KINDS[r.type]).map((r) => ({
    kind: KINDS[r.type],
    metadata: r.inputs.metadata ?? { name: r.name },
    spec: r.inputs.spec,
  }));
  const fromFiles = RESOURCES.filter((r) => Array.isArray(r.inputs.objs)).flatMap((r) => r.inputs.objs as Manifest[]);
  return [...direct, ...fromFiles].filter((m) => Object.values(KINDS).includes(m.kind));
}

function podTemplate(m: Manifest): Record<string, any> {
  if (m.kind === "Pod") return { metadata: m.metadata, spec: m.spec };
  if (m.kind === "CronJob") return m.spec?.jobTemplate?.spec?.template ?? {};
  return m.spec?.template ?? {};
}

function plannedPods(): PlannedPod[] {
  return manifests().map((m) => ({
    workload: `${m.kind}/${m.metadata?.name}`,
    namespace: m.metadata?.namespace,
    template: podTemplate(m),
  }));
}

function namespaceLevels(): Map<string, PodSecurityLevel> {
  const levels = new Map<string, PodSecurityLevel>();
  for (const ns of RESOURCES.filter((r) => r.type === "kubernetes:core/v1:Namespace")) {
    levels.set(ns.inputs.metadata.name, podSecurityLevel(ns.inputs.metadata.labels));
  }
  return levels;
}

type Selector = { matchLabels?: Record<string, string>; matchExpressions?: { key: string; operator: string; values?: string[] }[] };

function selects(selector: Selector, labels: Record<string, string>): boolean {
  const byLabel = Object.entries(selector.matchLabels ?? {}).every(([k, v]) => labels[k] === v);
  const byExpression = (selector.matchExpressions ?? []).every(({ key, operator, values = [] }) => {
    if (operator === "In") return key in labels && values.includes(labels[key]);
    if (operator === "NotIn") return !(key in labels) || !values.includes(labels[key]);
    if (operator === "Exists") return key in labels;
    if (operator === "DoesNotExist") return !(key in labels);
    throw new Error(`unknown selector operator ${operator}`);
  });
  return byLabel && byExpression;
}

describe("Pod Security admission of the dev stack's pods", () => {
  beforeAll(async () => {
    await planDevStack();
  });

  it("refuses what the baseline level refuses and admits the renderer's hardened container", () => {
    const pod = (securityContext: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
      containers: [{ name: "c", securityContext }],
      ...extra,
    });
    expect(podSecurityViolations("baseline", pod({ seccompProfile: { type: "Unconfined" } }))).toEqual(["seccomp Unconfined: c"]);
    expect(podSecurityViolations("baseline", pod({ privileged: true }))).toEqual(["privileged: c"]);
    expect(podSecurityViolations("baseline", pod({ capabilities: { add: ["SYS_ADMIN"] } }))).toEqual(["capability SYS_ADMIN added: c"]);
    expect(podSecurityViolations("baseline", pod({ capabilities: { add: ["NET_BIND_SERVICE"] } }))).toEqual([]);
    expect(podSecurityViolations("baseline", pod({}, { hostPID: true }))).toEqual(["host namespaces: hostPID"]);
    expect(podSecurityViolations("baseline", pod({}, { volumes: [{ name: "logs", hostPath: { path: "/var/log" } }] }))).toEqual([
      "hostPath volume: logs",
    ]);
    expect(podSecurityViolations("privileged", pod({ privileged: true }))).toEqual([]);
  });

  it("declares a Pod Security level on the app namespace", () => {
    expect(namespaceLevels().get("grid")).toBe("baseline");
  });

  it("builds the renderer, so its pod is among those checked", () => {
    expect(plannedPods().map((p) => p.workload)).toContain(`Deployment/${BROWSER_RENDERER.name}`);
  });

  it("has no pod its namespace's Pod Security level would refuse", () => {
    const levels = namespaceLevels();
    const refused = plannedPods()
      .filter((p) => p.namespace !== undefined && levels.has(p.namespace))
      .map((p) => [
        `${p.namespace}/${p.workload}`,
        podSecurityViolations(levels.get(p.namespace as string) as PodSecurityLevel, p.template.spec ?? {}, p.template.metadata?.annotations),
      ] as const)
      .filter(([, v]) => v.length > 0);
    expect(Object.fromEntries(refused)).toEqual({});
  });

  it("lets only the code runner reach the renderer and the renderer reach nothing", () => {
    const labels = commonLabels(BROWSER_RENDERER.name) as Record<string, string>;
    const applying = RESOURCES.filter(
      (r) => r.type === "kubernetes:networking.k8s.io/v1:NetworkPolicy" && r.inputs.metadata?.namespace === "grid",
    ).filter((r) => selects(r.inputs.spec.podSelector, labels));
    const ingress = applying.filter((r) => r.inputs.spec.policyTypes.includes("Ingress")).flatMap((r) => r.inputs.spec.ingress ?? []);
    const egressPolicies = applying.filter((r) => r.inputs.spec.policyTypes.includes("Egress"));
    expect(ingress).toEqual([
      {
        from: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "code-runner" } } }],
        ports: [{ protocol: "TCP", port: BROWSER_RENDERER.port }],
      },
    ]);
    expect(egressPolicies.length).toBeGreaterThan(0);
    expect(egressPolicies.flatMap((r) => r.inputs.spec.egress ?? [])).toEqual([]);
  });
});
