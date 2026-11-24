import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { Cmd, DockerfileParser, Env, From, Healthcheck, type Instruction, ModifiableInstruction } from "dockerfile-ast";
import ts from "typescript";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "../test-support/stack-config";
import { LEGACY_PROJECT } from "../names";

type Probe = { httpGet: { path: string; port: number } };
type Container = {
  command?: string[];
  ports?: Array<{ containerPort: number }>;
  readinessProbe: Probe;
  livenessProbe: Probe;
};

const repoRoot = join(__dirname, "..", "..", "..", "..");
const WEBSITE = join(repoRoot, "apps", "website");
const WORKSPACE = join(repoRoot, "apps", "workspace");

let web: Container;
let carry: Container;
let knowledgeReleasesDir = "";

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      if (args.type === "kubernetes:apps/v1:Deployment" && args.name === "web") web = args.inputs.spec.template.spec.containers[0];
      if (args.type === "kubernetes:batch/v1:Job" && args.name.startsWith("knowledge-carry-")) {
        carry = args.inputs.spec.template.spec.containers[0];
      }
      return { id: `${args.name}-id`, state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } } };
    },
    call: () => ({}),
  },
  LEGACY_PROJECT,
  "test",
  false,
);

function finalStage(dockerfile: string): Instruction[] {
  const instructions = DockerfileParser.parse(readFileSync(dockerfile, "utf8")).getInstructions();
  const froms = instructions.filter((instruction) => instruction instanceof From);
  return instructions.slice(instructions.indexOf(froms[froms.length - 1]));
}

function copiesFromBuilder(stage: Instruction[]): string[] {
  return stage
    .filter(
      (instruction) =>
        instruction.getKeyword() === "COPY" &&
        instruction instanceof ModifiableInstruction &&
        instruction.getFlags().some((flag) => flag.getName() === "from" && flag.getValue() === "builder"),
    )
    .map((instruction) => instruction.getArguments().map((argument) => argument.getValue()).join(" "));
}

function envOf(stage: Instruction[]): Map<string, string | null> {
  return new Map(
    stage
      .filter((instruction): instruction is Env => instruction instanceof Env)
      .flatMap((instruction) => instruction.getProperties())
      .map((property) => [property.getName(), property.getValue()] as const),
  );
}

function bundledNames(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "naming" &&
      ts.isStringLiteralLike(node.initializer)
    ) {
      names.push(node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

describe("the images the deploy runs", () => {
  beforeAll(async () => {
    pulumi.runtime.setAllConfig({
      ...baseStackConfig(),
      [`${LEGACY_PROJECT}:observabilityEnabled`]: "false",
      [`${LEGACY_PROJECT}:knowledgeCarry`]: "true",
      [`${LEGACY_PROJECT}:imageTag`]: "sha-" + "a".repeat(40),
    });
    const { loadConfig } = await import("../config");
    const { buildSecrets } = await import("./config");
    const { installWeb } = await import("./web");
    const { runKnowledgeCarry, KNOWLEDGE_RELEASES_DIR } = await import("./knowledge-carry-job");
    knowledgeReleasesDir = KNOWLEDGE_RELEASES_DIR;
    const cfg = loadConfig();
    const provider = new k8s.Provider("test", { kubeconfig: "apiVersion: v1" });
    const wiring = {
      cfg,
      namespace: "grid",
      provider,
      redisUrl: pulumi.output("redis://dragonfly:6379"),
      seaweedInternalEndpoint: pulumi.output("http://seaweedfs:8333"),
      seaweedPublicEndpoint: pulumi.output("https://s3.example.test"),
      qdrantUrl: pulumi.output("http://qdrant.grid.svc.cluster.local:6333"),
      dsn: (opts: { db: string }) => pulumi.output(`postgresql://x/${opts.db}`),
      imagePullSecrets: [],
    };
    const installed = installWeb(cfg, provider, "grid", [], []);
    const job = runKnowledgeCarry(wiring, cfg, buildSecrets(wiring), []);
    await Promise.all([installed.deployment.id, job.id].map((id) => new Promise((done) => id.apply(done))));
  });

  describe("the website image, which the web Deployment starts as it is", () => {
    const runner = finalStage(join(WEBSITE, "Dockerfile"));

    it("starts an entry file of the site that the runner copies from the build", () => {
      expect(web.command).toBeUndefined();
      const cmd = runner.filter((instruction): instruction is Cmd => instruction instanceof Cmd);
      const [node, entry] = cmd[cmd.length - 1].getJSONStrings().map((part) => part.getJSONValue());
      expect(node).toBe("node");
      expect(existsSync(join(WEBSITE, entry))).toBe(true);
      const top = entry.split("/")[0];
      expect(copiesFromBuilder(runner)).toContain(`/app/${top} ./${top}`);
    });

    it("listens on the port the Deployment routes to, and checks its health where the Deployment probes", () => {
      const port = web.ports?.[0]?.containerPort;
      expect(envOf(runner).get("PORT")).toBe(String(port));
      expect(web.readinessProbe.httpGet).toEqual(web.livenessProbe.httpGet);
      expect(web.readinessProbe.httpGet.port).toBe(port);
      const healthcheck = runner.filter((instruction): instruction is Healthcheck => instruction instanceof Healthcheck);
      expect(healthcheck).toHaveLength(1);
      expect(healthcheck[0].getSubcommand()?.getValue()).toBe("CMD");
      expect(healthcheck[0].getArguments().map((argument) => argument.getValue())).toContain(
        `http://localhost:${port}${web.readinessProbe.httpGet.path}`,
      );
    });
  });

  describe("the workspace image, which the knowledge carry Job runs", () => {
    const runner = finalStage(join(WORKSPACE, "deploy", "Dockerfile"));

    it("builds and copies the bundle the Job starts", () => {
      const [node, entry] = carry.command ?? [];
      expect(node).toBe("node");
      expect(bundledNames(join(WORKSPACE, "scripts", "build-jobs-bundle.ts"))).toContain(basename(entry));
      expect(copiesFromBuilder(runner)).toContain(`/app/${dirname(entry)} ./${dirname(entry)}`);
    });

    it("copies the knowledge releases the Job carries to where the Job reads them", () => {
      const releases = relative(WORKSPACE, knowledgeReleasesDir);
      expect(existsSync(join(knowledgeReleasesDir, "manifest.json"))).toBe(true);
      expect(copiesFromBuilder(runner)).toContain(`/app/${releases} ./${releases}`);
    });
  });
});
