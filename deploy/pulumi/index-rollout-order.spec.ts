import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "./src/test-support/stack-config";
import { DependencyGraph } from "./src/test-support/dependency-graph";

const DEPLOYMENT = "kubernetes:apps/v1:Deployment";
const STATEFULSET = "kubernetes:apps/v1:StatefulSet";
const SERVICE = "kubernetes:core/v1:Service";

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

describe("rollout order: api and chat, then the frontend", () => {
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

  it("rolls the frontend out only after the api Service", () => {
    expect(graph.waitsOn(DEPLOYMENT, "frontend", SERVICE, "api")).toBe(true);
  });

  it("rolls the frontend out only after the chat tier it dials", () => {
    expect(graph.waitsOn(DEPLOYMENT, "frontend", STATEFULSET, "chat")).toBe(true);
    expect(graph.waitsOn(DEPLOYMENT, "frontend", SERVICE, "chat")).toBe(true);
  });

  it("never makes the chat tier wait on the frontend, which would be a cycle", () => {
    expect(graph.waitsOn(STATEFULSET, "chat", DEPLOYMENT, "frontend")).toBe(false);
  });
});
