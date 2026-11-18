import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "./src/test-support/stack-config";

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

describe("the pooler with a single instance", () => {
  beforeAll(async () => {
    pulumi.runtime.setAllConfig({
      ...baseStackConfig(),
      "grid-oib:pgPoolerInstances": "1",
      "grid-oib:seaweedfsTopology": "single",
      "grid-oib:observabilityEnabled": "false",
    });
    const stack = (await import("./index")) as Record<string, unknown>;
    await Promise.all(
      Object.values(stack)
        .filter((v): v is pulumi.Output<unknown> => pulumi.Output.isInstance(v))
        .map((output) => new Promise((resolve) => output.apply(resolve))),
    );
  }, 120_000);

  const pooler = () => RESOURCES.find((r) => r.type === "kubernetes:postgresql.cnpg.io/v1:Pooler")!;

  it("runs one pooler, without a spread constraint", () => {
    const spec = pooler().inputs.spec as { instances: number; template: { spec: Record<string, unknown> } };

    expect(spec.instances).toBe(1);
    expect(spec.template.spec.topologySpreadConstraints).toBeUndefined();
  });

  it("creates no PodDisruptionBudget for it", () => {
    const pdbs = RESOURCES.filter((r) => r.type === "kubernetes:policy/v1:PodDisruptionBudget");

    expect(pdbs.map((r) => r.name)).not.toContain("grid-pg-pooler-rw");
  });
});
