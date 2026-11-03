import { describe, expect, it } from "vitest";
import { gateOperatorRollout, operatorManifest } from "./rabbitmq";

describe("the vendored RabbitMQ operator manifest", () => {
  const objects = operatorManifest();
  const deployments = objects.filter((o) => o.kind === "Deployment");

  it("holds the operator's one Deployment and its CRDs", () => {
    expect(deployments.map((d) => (d.metadata as { name: string }).name)).toEqual(["rabbitmq-cluster-operator"]);
    expect(objects.some((o) => o.kind === "CustomResourceDefinition")).toBe(true);
  });

  // The policy pack's mandatory rules (deploy/pulumi/policy/index.ts) refused the
  // upstream Deployment on the first staging preview that included it.
  it("gates the operator's rollout the way the policy pack requires of every Deployment", () => {
    const spec = deployments[0].spec as Record<string, unknown>;

    expect(spec.minReadySeconds).toBeGreaterThanOrEqual(1); // deployment-rollout-gated
    expect(spec.progressDeadlineSeconds).toBeGreaterThanOrEqual(1); // deployment-rollout-gated
    expect(spec.strategy).toEqual({ type: "RollingUpdate", rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } }); // deployment-no-capacity-dip
    const pod = (spec.template as { spec: { terminationGracePeriodSeconds?: number; containers: { resources?: { requests?: object; limits?: object } }[] } }).spec;
    expect(pod.terminationGracePeriodSeconds).toBeGreaterThanOrEqual(5); // workload-graceful-termination
    for (const c of pod.containers) {
      expect(c.resources?.requests).toMatchObject({ cpu: expect.anything(), memory: expect.anything() }); // container-resources-bounded
      expect(c.resources?.limits).toMatchObject({ cpu: expect.anything(), memory: expect.anything() });
    }
  });

  it("keeps everything upstream set, and touches nothing but the Deployment", () => {
    const upstream = { kind: "Deployment", spec: { replicas: 1, selector: { matchLabels: { a: "b" } } } };
    expect(gateOperatorRollout(upstream).spec).toMatchObject(upstream.spec);
    const crd = { kind: "CustomResourceDefinition", spec: { group: "rabbitmq.com" } };
    expect(gateOperatorRollout(crd)).toBe(crd);
  });
});
