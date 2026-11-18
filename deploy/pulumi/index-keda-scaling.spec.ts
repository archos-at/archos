import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "./src/test-support/stack-config";
import { DependencyGraph } from "./src/test-support/dependency-graph";

const SCALED = "kubernetes:keda.sh/v1alpha1:ScaledObject";
const AUTH = "kubernetes:keda.sh/v1alpha1:TriggerAuthentication";
const JOB = "kubernetes:batch/v1:Job";
const RELEASE = "kubernetes:helm.sh/v3:Release";
const QUEUE_TIERS = ["ingest-worker", "agent-worker", "bff-jobs"];

let graph: DependencyGraph;

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => ({
      id: `${args.name}-id`,
      state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } },
    }),
    call: () => ({}),
  },
  "grid-oib",
  "test",
  false,
);

describe("the queue tiers' ScaledObjects in the program", () => {
  beforeAll(async () => {
    graph = new DependencyGraph();
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), "grid-oib:observabilityEnabled": "false" });
    const stack = (await import("./index")) as Record<string, unknown>;
    await Promise.all(
      Object.values(stack)
        .filter((v): v is pulumi.Output<unknown> => pulumi.Output.isInstance(v))
        .map((output) => new Promise((resolve) => output.apply(resolve))),
    );
  }, 120_000);

  it("is in place before any worker tier's ScaledObject, by the program's own ordering", () => {
    for (const tier of QUEUE_TIERS) {
      expect(graph.waitsOn(SCALED, tier, RELEASE, "keda"), tier).toBe(true);
      expect(graph.waitsOn(SCALED, tier, JOB, "background-work-pg-grants"), tier).toBe(true);
      expect(graph.waitsOn(SCALED, tier, AUTH, "hatchet-queue-auth"), tier).toBe(true);
      expect(graph.waitsOn(SCALED, tier, JOB, "hatchet-token-sync"), tier).toBe(true);
    }
  });
});
