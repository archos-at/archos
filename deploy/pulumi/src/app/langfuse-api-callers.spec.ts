import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig, langfuseStackConfig } from "../test-support/stack-config";

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => ({ id: `${args.name}-id`, state: args.inputs }),
    call: () => ({}),
  },
  "grid-oib",
  "test",
  false,
);

const repoRoot = join(__dirname, "..", "..", "..", "..");
const LANGFUSE_API = /^LANGFUSE_(HOST|PUBLIC_KEY|SECRET_KEY)$/;

type EnvVar = k8s.types.input.core.v1.EnvVar;
const apiNames = (env: EnvVar[]) => env.map((e) => String(e.name)).filter((name) => LANGFUSE_API.test(name));

describe("Langfuse's API credentials, with the tier deployed", () => {
  const envs: Record<string, EnvVar[]> = {};

  beforeAll(async () => {
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), ...langfuseStackConfig() });
    const { loadConfig } = await import("../config");
    const { frontendEnv, purgerEnv } = await import("./config");
    const { bffJobsEnv } = await import("./bff-jobs-env");
    const cfg = loadConfig();
    expect(cfg.langfuse.enabled).toBe(true);
    const wiring = {
      cfg,
      namespace: "grid",
      provider: new k8s.Provider("test", { kubeconfig: "apiVersion: v1" }),
      redisUrl: pulumi.output("redis://dragonfly:6379"),
      seaweedInternalEndpoint: pulumi.output("http://seaweedfs:8333"),
      seaweedPublicEndpoint: pulumi.output("https://s3.example.test"),
      qdrantUrl: pulumi.output("http://qdrant.grid.svc.cluster.local:6333"),
      dsn: () => pulumi.output("postgresql://x"),
      imagePullSecrets: [],
    };
    envs.frontend = frontendEnv(wiring as never);
    envs.bffJobs = bffJobsEnv(wiring as never);
    envs.purger = purgerEnv(wiring as never);
  });

  it("are in the frontend's, which scores votes", () => {
    expect(apiNames(envs.frontend).sort()).toEqual(["LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"]);
  });

  it("are in the purger's and bff-jobs', the two pods the network policy admits, once each", () => {
    expect(apiNames(envs.purger).sort()).toEqual(["LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"]);
    expect(apiNames(envs.bffJobs).sort()).toEqual(["LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"]);
    const policies = readFileSync(join(repoRoot, "deploy", "pulumi", "src", "platform", "network-policies.ts"), "utf8");
    expect(policies).toContain('from: ["purger", "bff-jobs"].map(');
  });

  it("are not reached for by the BFF's own code, outside the sweeps only bff-jobs runs", () => {
    const BFF_JOBS_ONLY = new Set([join("scheduling", "sweeps.ts")]);
    const importers = ["app", "bff", "ui", "i18n", "shared", "types", "utils"].flatMap((dir) => {
      const root = join(repoRoot, "apps", "workspace", dir);
      return (readdirSync(root, { recursive: true }) as string[])
        .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.spec\.tsx?$/.test(file))
        .filter((file) => readFileSync(join(root, file), "utf8").includes("workers/langfuse-traces"))
        .filter((file) => !(dir === "bff" && BFF_JOBS_ONLY.has(file)));
    });
    expect(importers).toEqual([]);
  });
});
