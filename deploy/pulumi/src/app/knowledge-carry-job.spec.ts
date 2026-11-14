import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "../test-support/stack-config";
import { LEGACY_PROJECT } from "../names";

// src/app -> src -> deploy/pulumi -> deploy -> repo root
const repoRoot = join(__dirname, "..", "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), "utf8");

/**
 * The promotion's carry of reviewed knowledge releases (ADR-0181). It crosses
 * three boundaries the plan cannot see into: the bundle the image builds
 * (`dist-jobs/knowledge-carry.mjs`), the directory the image copies, and the
 * one switch (`KNOWLEDGE_SINGLE_OPERATOR`) that must be this pod's alone.
 */

const RESOURCES: Array<{ type: string; name: string; inputs: Record<string, any> }> = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}-id`, state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } } };
    },
    call: () => ({}),
  },
  LEGACY_PROJECT,
  "prod",
  false,
);

function resolve<T>(value: pulumi.Input<T>): Promise<T> {
  return new Promise((done) => pulumi.output(value).apply((v) => done(v as T)));
}

describe("the knowledge carry Job", () => {
  let job: (typeof RESOURCES)[number];
  let digest = "";

  beforeAll(async () => {
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), [`${LEGACY_PROJECT}:knowledgeCarry`]: "true", [`${LEGACY_PROJECT}:imageTag`]: "sha-" + "a".repeat(40) });
    const { loadConfig } = await import("../config");
    const { buildSecrets } = await import("./config");
    const { runKnowledgeCarry, knowledgeReleasesDigest } = await import("./knowledge-carry-job");
    const cfg = loadConfig();
    const wiring = {
      cfg,
      namespace: "grid",
      provider: new k8s.Provider("test", { kubeconfig: "apiVersion: v1" }),
      redisUrl: pulumi.output("redis://dragonfly:6379"),
      seaweedInternalEndpoint: pulumi.output("http://seaweedfs:8333"),
      seaweedPublicEndpoint: pulumi.output("https://s3.example.test"),
      qdrantUrl: pulumi.output("http://qdrant.grid.svc.cluster.local:6333"),
      dsn: (opts: { db: string }) => pulumi.output(`postgresql://x/${opts.db}`),
      imagePullSecrets: [],
    };
    const made = runKnowledgeCarry(wiring, cfg, buildSecrets(wiring), []);
    await new Promise((done) => made.id.apply(done));
    digest = knowledgeReleasesDigest();
    job = RESOURCES.find((r) => r.type === "kubernetes:batch/v1:Job" && r.name.startsWith("knowledge-carry-"))!;
  });

  it("is named after the bundles, so it reruns only when they change", () => {
    expect(job.name).toBe(`knowledge-carry-${digest}`);
    const dir = mkdtempSync(join(tmpdir(), "carry-"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ format: "knowledge-carry/1", sourceDeployment: "dev", bundles: [{ file: "xa-1.json.gz" }] }));
    writeFileSync(join(dir, "xa-1.json.gz"), "one");
    return import("./knowledge-carry-job").then(({ knowledgeReleasesDigest }) => {
      const first = knowledgeReleasesDigest(dir);
      writeFileSync(join(dir, "xa-1.json.gz"), "two");
      expect(knowledgeReleasesDigest(dir)).not.toBe(first);
    });
  });

  it("is not awaited by the deploy, and runs the bundled carry from the frontend image", async () => {
    const metadata = await resolve(job.inputs.metadata);
    expect(metadata.annotations).toMatchObject({ "pulumi.com/skipAwait": "true", "pulumi.com/deletionPropagationPolicy": "background" });
    const pod = (await resolve(job.inputs.spec)).template.spec;
    expect(pod.containers[0].command).toEqual(["node", "dist-jobs/knowledge-carry.mjs"]);
    expect(pod.containers[0].image).toMatch(/-frontend:sha-a{40}$/);
    // The entry the image bundles, and the directory it copies.
    expect(read("apps", "workspace", "scripts", "build-jobs-bundle.ts")).toContain("scripts/knowledge-carry.ts");
    expect(read("apps", "workspace", "deploy", "Dockerfile")).toMatch(/COPY .*\/app\/config\/knowledge-releases \.\/config\/knowledge-releases/);
    expect(existsSync(join(repoRoot, "apps", "workspace", "config", "knowledge-releases", "manifest.json"))).toBe(true);
  });

  it("turns one operator alone on for its own pod, once, and names the deployment and the promotion", async () => {
    const env = (await resolve(job.inputs.spec)).template.spec.containers[0].env as { name: string; value?: string }[];
    expect(env.filter((e) => e.name === "KNOWLEDGE_SINGLE_OPERATOR")).toEqual([{ name: "KNOWLEDGE_SINGLE_OPERATOR", value: "true" }]);
    expect(env.find((e) => e.name === "KNOWLEDGE_CARRY_DEPLOYMENT")?.value).toBe("prod");
    expect(env.find((e) => e.name === "KNOWLEDGE_CARRY_PROMOTION")?.value).toBe(`image sha-${"a".repeat(40)}`);
    // The BFF's own environment comes with it: the database and the backend it calls.
    expect(env.map((e) => e.name)).toEqual(expect.arrayContaining(["BACKEND_URL"]));
  });
});
