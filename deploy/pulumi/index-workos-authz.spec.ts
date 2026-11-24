import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Copy, DockerfileParser, Run } from "dockerfile-ast";
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
    const instructions = DockerfileParser.parse(readFileSync(resolve(UI, "deploy/Dockerfile"), "utf8")).getInstructions();
    const loop = instructions
      .filter((instruction) => instruction instanceof Run)
      .map((instruction) => instruction.getArguments().map((argument) => argument.getValue()))
      .find((words) => words.slice(0, 3).join(" ") === "for script in");
    const listEnd = loop?.findIndex((word) => word.endsWith(";")) ?? -1;
    expect(listEnd, "deploy/Dockerfile has no `for script in ...;` RUN loop").toBeGreaterThan(2);
    const bundled = (loop ?? []).slice(3, listEnd + 1).map((word) => (word.endsWith(";") ? word.slice(0, -1) : word));
    for (const job of ["grid-app-authz-catalog", "grid-app-folder-grants"]) {
      const command = commands.get(job) ?? [];
      expect(command[0]).toBe("node");
      const bundle = /^dist-scripts\/(.+)\.mjs$/.exec(command[1] ?? "");
      expect(bundle, `${job} runs ${command.join(" ")}`).not.toBeNull();
      const script = bundle?.[1] ?? "";
      expect(existsSync(resolve(UI, `scripts/${script}.ts`))).toBe(true);
      expect(bundled).toContain(script);
      expect(command).toContain("--apply");
    }
    const copies = instructions
      .filter((instruction) => instruction instanceof Copy)
      .map((instruction) => ({
        flags: instruction.getFlags().map((flag) => `${flag.getName()}=${flag.getValue()}`),
        paths: instruction.getArguments().map((argument) => argument.getValue()),
      }));
    expect(copies).toContainEqual({
      flags: ["from=builder", "chown=nextjs:nodejs"],
      paths: ["/app/dist-scripts", "./dist-scripts"],
    });
  });
});
