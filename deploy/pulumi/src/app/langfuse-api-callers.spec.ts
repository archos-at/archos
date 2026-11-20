import { describe, it, expect, beforeAll } from "vitest";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig, langfuseStackConfig } from "../test-support/stack-config";

type Resource = { type: string; name: string; inputs: Record<string, any> };
const RESOURCES: Resource[] = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}-id`, state: args.inputs };
    },
    call: () => ({}),
  },
  "grid-oib",
  "test",
  false,
);

const NETWORK_POLICY = "kubernetes:networking.k8s.io/v1:NetworkPolicy";
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
    const { installNetworkPolicies } = await import("../platform/network-policies");
    const cfg = loadConfig();
    expect(cfg.langfuse.enabled).toBe(true);
    const provider = new k8s.Provider("test", { kubeconfig: "apiVersion: v1" });
    const wiring = {
      cfg,
      namespace: "grid",
      provider,
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
    const policies = installNetworkPolicies(cfg, provider, "grid");
    await Promise.all(policies.map((policy) => new Promise((done) => policy.id.apply(done))));
  }, 60_000);

  it("are in the frontend's, which scores votes", () => {
    expect(apiNames(envs.frontend).sort()).toEqual(["LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"]);
  });

  it("are in the purger's and bff-jobs', the two pods the network policy admits, once each", () => {
    expect(apiNames(envs.purger).sort()).toEqual(["LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"]);
    expect(apiNames(envs.bffJobs).sort()).toEqual(["LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"]);
    const policy = RESOURCES.find((r) => r.type === NETWORK_POLICY && r.name === "allow-workers-to-langfuse");
    expect(policy, "allow-workers-to-langfuse").toBeDefined();
    const admitted = policy!.inputs.spec.ingress[0].from.map(
      (peer: { podSelector: { matchLabels: Record<string, string> } }) => peer.podSelector.matchLabels["app.kubernetes.io/name"],
    );
    expect(admitted.sort()).toEqual(["bff-jobs", "purger"]);
  });
});
