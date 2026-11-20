import { describe, it, expect, beforeAll } from "vitest";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "../test-support/stack-config";
import type { AppWiring } from "./config";

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

type EnvEntry = { name: string; value?: unknown; valueFrom?: { secretKeyRef?: { name: string; key: string } } };

function secretRef(env: EnvEntry[], name: string) {
  return env.find((e) => e.name === name)?.valueFrom?.secretKeyRef;
}

const RETIRED_FEATURE_SWITCHES = [
  "ENFORCE_FEATURE_FLAGS",
  "SKILLS_ENABLED",
  "COLLABORATION_ENABLED",
  "MAIL_IMPORT_ENABLED",
  "IFC_MODELS_ENABLED",
  "AGENT_AUTHORED_DOCUMENTS_ENABLED",
  "MEMORY_REFLECTION_ENABLED",
  "WORKFLOWS_ENABLED",
];

const EXTRACTION_SWITCHES = ["EXTRACT_TABLES", "EXTRACT_IMAGES", "EXTRACT_CHARTS"];

let app: typeof import("./config");
let wiring: AppWiring;

beforeAll(async () => {
  pulumi.runtime.setAllConfig({ ...baseStackConfig(), "grid-oib:observabilityEnabled": "false" });
  app = await import("./config");
  const { loadConfig } = await import("../config");
  const cfg = loadConfig();
  wiring = {
    cfg,
    namespace: "grid",
    provider: new k8s.Provider("test", { kubeconfig: "apiVersion: v1" }),
    redisUrl: pulumi.output("redis://dragonfly:6379"),
    seaweedInternalEndpoint: pulumi.output("http://seaweedfs:8333"),
    seaweedPublicEndpoint: pulumi.output("https://s3.example.test"),
    qdrantUrl: pulumi.output("http://qdrant.grid.svc.cluster.local:6333"),
    dsn: () => pulumi.output("postgresql://x"),
    imagePullSecrets: [],
  } as unknown as AppWiring;
}, 120_000);

describe("purgerEnv", () => {
  const fakeWiring = (langfuseEnabled: boolean) =>
    ({
      cfg: {
        observability: { enabled: false },
        seaweedfs: { accessKey: "a", bucket: "b" },
        langfuse: { enabled: langfuseEnabled },
      },
      seaweedInternalEndpoint: "http://seaweedfs:8333",
    }) as unknown as AppWiring;

  it("gives the purger Langfuse's API to delete an erased chat's traces", () => {
    const env = app.purgerEnv(fakeWiring(true)) as EnvEntry[];
    expect(env.find((e) => e.name === "LANGFUSE_HOST")?.value).toBe("http://langfuse-web:3000");
    expect(secretRef(env, "LANGFUSE_PUBLIC_KEY")?.key).toBe("public-key");
    expect(secretRef(env, "LANGFUSE_SECRET_KEY")?.key).toBe("secret-key");
  });

  it("emits nothing about Langfuse without the tier", () => {
    const env = app.purgerEnv(fakeWiring(false)) as EnvEntry[];
    expect(env.map((e) => e.name)).toContain("BACKEND_URL");
    expect(env.filter((e) => /LANGFUSE/.test(String(e.name)))).toEqual([]);
  });
});

describe("frontendEnv", () => {
  it("emits none of the retired feature switches", () => {
    const names = (app.frontendEnv(wiring) as EnvEntry[]).map((e) => e.name);
    expect(names).toContain("BACKEND_URL");
    expect(names.filter((name) => RETIRED_FEATURE_SWITCHES.includes(name))).toEqual([]);
  });
});

describe("backendEnv extraction switches", () => {
  it("sets none of them, so none can be left off by omission", () => {
    const names = (app.backendEnv(wiring) as EnvEntry[]).map((e) => e.name);
    expect(names).toContain("CONFIG_FILE");
    expect(names.filter((name) => EXTRACTION_SWITCHES.includes(name))).toEqual([]);
  });
});
