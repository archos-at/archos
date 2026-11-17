import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "./src/test-support/stack-config";
import { DependencyGraph } from "./src/test-support/dependency-graph";

const JOB = "kubernetes:batch/v1:Job";
const DEPLOYMENT = "kubernetes:apps/v1:Deployment";
const UI = resolve(__dirname, "../../apps/workspace");

let graph: DependencyGraph;
const commands = new Map<string, string[]>();

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      if (args.type === JOB) {
        const containers = args.inputs.spec?.template?.spec?.containers ?? [];
        commands.set(args.name, containers[0]?.command ?? []);
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

describe("WorkOS authorization rollout runs with the deploy", () => {
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

  it("carries folder grants over only after the frontend, the migrations and the catalog", () => {
    expect(graph.waitsOn(JOB, "grid-app-folder-grants", DEPLOYMENT, "frontend")).toBe(true);
    expect(graph.waitsOn(JOB, "grid-app-folder-grants", JOB, "grid-app-migrate")).toBe(true);
    expect(graph.waitsOn(JOB, "grid-app-folder-grants", JOB, "grid-app-authz-catalog")).toBe(true);
  });

  it("never makes the frontend wait on WorkOS", () => {
    expect(graph.waitsOn(DEPLOYMENT, "frontend", JOB, "grid-app-authz-catalog")).toBe(false);
    expect(graph.waitsOn(DEPLOYMENT, "frontend", JOB, "grid-app-folder-grants")).toBe(false);
  });

  it("runs only bundles the frontend image builds, from scripts that exist", () => {
    const dockerfile = readFileSync(resolve(UI, "deploy/Dockerfile"), "utf8");
    for (const job of ["grid-app-authz-catalog", "grid-app-folder-grants"]) {
      const command = commands.get(job) ?? [];
      expect(command[0]).toBe("node");
      const bundle = /^dist-scripts\/(.+)\.mjs$/.exec(command[1] ?? "");
      expect(bundle, `${job} runs ${command.join(" ")}`).not.toBeNull();
      const script = bundle?.[1] ?? "";
      expect(existsSync(resolve(UI, `scripts/${script}.ts`))).toBe(true);
      expect(dockerfile).toMatch(new RegExp(`for script in [^;]*\\b${script}\\b`));
      expect(command).toContain("--apply");
    }
    expect(dockerfile).toContain("COPY --from=builder --chown=nextjs:nodejs /app/dist-scripts ./dist-scripts");
  });
});
