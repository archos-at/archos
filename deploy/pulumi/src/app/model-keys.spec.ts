import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "../test-support/stack-config";
import { OPENROUTER_KEY_ENV, OPENROUTER_SECRET_KEY } from "./model-keys";
import { LEGACY_PROJECT } from "../names";

/** A stack config key under the project these specs run as. */
const key = (name: string): string => `${LEGACY_PROJECT}:${name}`;

/**
 * One OpenRouter key per workload. On 2026-11-02 (and 10-12, 10-19) a bulk
 * ingest held the one shared key's balance in flight and OpenRouter answered
 * 402 to chat and research in the same minute. A per-key credit limit only
 * helps if each tier really carries only its own key, which nothing at plan
 * time would otherwise notice: every key is a valid key.
 */

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => ({ id: `${args.name}-id`, state: args.inputs }),
    call: () => ({}),
  },
  LEGACY_PROJECT,
  "test",
  false,
);

type EnvVar = k8s.types.input.core.v1.EnvVar;

// src/app -> src -> deploy/pulumi -> deploy -> repo root
const repoRoot = join(__dirname, "..", "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), "utf8");

function resolve<T>(value: pulumi.Input<T>): Promise<T> {
  return new Promise((done) => pulumi.output(value).apply((v) => done(v as T)));
}

const OWN_KEYS = {
  [key("openrouterChatKey")]: "or-chat", // pragma: allowlist secret
  [key("openrouterResearchKey")]: "or-research", // pragma: allowlist secret
  [key("openrouterIngestKey")]: "or-ingest", // pragma: allowlist secret
};

async function load(config: Record<string, string>) {
  pulumi.runtime.setAllConfig({ ...baseStackConfig(), [key("observabilityEnabled")]: "false", ...config });
  const { loadConfig } = await import("../config");
  const app = await import("./config");
  const { bffJobsEnv } = await import("./bff-jobs-env");
  const cfg = loadConfig();
  const wiring = {
    cfg,
    namespace: "app",
    provider: new k8s.Provider("test-keys", { kubeconfig: "apiVersion: v1" }),
    redisUrl: pulumi.output("redis://dragonfly:6379"),
    seaweedInternalEndpoint: pulumi.output("http://seaweedfs:8333"),
    seaweedPublicEndpoint: pulumi.output("https://s3.example.test"),
    qdrantUrl: pulumi.output("http://qdrant:6333"),
    dsn: () => pulumi.output("postgresql://x"),
    imagePullSecrets: [],
  };
  const tiers: Record<string, EnvVar[]> = {
    chat: app.chatEnv(wiring as never),
    api: app.apiEnv(wiring as never),
    "agent-worker": app.workerEnv(wiring as never),
    "ingest-worker": app.ingestWorkerEnv(wiring as never, "/tmp/alive"),
    frontend: app.frontendEnv(wiring as never),
    "bff-jobs": bffJobsEnv(wiring as never),
  };
  const secret = app.buildSecrets(wiring as never);
  const stringData = await resolve(secret.secret.stringData as pulumi.Input<Record<string, string>>);
  return { tiers, stringData };
}

/** The Secret key each OpenRouter-key env name of a tier is read from. */
function keyRefs(env: EnvVar[]): Record<string, string> {
  return Object.fromEntries(
    env
      .filter((e) => (OPENROUTER_KEY_ENV as readonly string[]).includes(e.name as string))
      .map((e) => [e.name, (e.valueFrom as { secretKeyRef: { key: string } }).secretKeyRef.key]),
  );
}

const EXPECTED_WORKLOAD: Record<string, keyof typeof OPENROUTER_SECRET_KEY> = {
  chat: "chat",
  api: "chat",
  "agent-worker": "research",
  "ingest-worker": "ingest",
  frontend: "chat",
  "bff-jobs": "chat",
};

describe("one OpenRouter key per workload", () => {
  it("gives each tier only its own workload's key, under every name the code reads", async () => {
    const { tiers } = await load(OWN_KEYS);
    for (const [tier, env] of Object.entries(tiers)) {
      const refs = keyRefs(env);
      const own = OPENROUTER_SECRET_KEY[EXPECTED_WORKLOAD[tier]];
      expect(Object.keys(refs).length, tier).toBeGreaterThan(0);
      expect(new Set(Object.values(refs)), tier).toEqual(new Set([own]));
      const backendTier = tier !== "frontend" && tier !== "bff-jobs";
      // The Python tiers read all three names; the BFF reads OPENROUTER_API_KEY only.
      expect(Object.keys(refs).sort(), tier).toEqual(
        backendTier ? [...OPENROUTER_KEY_ENV].sort() : ["OPENROUTER_API_KEY"],
      );
    }
  });

  it("puts each stack secret in the Secret under its workload's key", async () => {
    const { stringData } = await load(OWN_KEYS);
    expect(stringData[OPENROUTER_SECRET_KEY.chat]).toBe("or-chat");
    expect(stringData[OPENROUTER_SECRET_KEY.research]).toBe("or-research");
    expect(stringData[OPENROUTER_SECRET_KEY.ingest]).toBe("or-ingest");
  });

  it("falls back to openrouterApiKey for every workload the stack has not given its own key", async () => {
    const { stringData } = await load({ [key("openrouterIngestKey")]: "or-ingest" }); // pragma: allowlist secret
    expect(stringData[OPENROUTER_SECRET_KEY.chat]).toBe("or");
    expect(stringData[OPENROUTER_SECRET_KEY.research]).toBe("or");
    expect(stringData[OPENROUTER_SECRET_KEY.ingest]).toBe("or-ingest");
  });

  it("keeps the chat key under OPENROUTER_API_KEY, the name a pod of the previous release references", () => {
    expect(OPENROUTER_SECRET_KEY.chat).toBe("OPENROUTER_API_KEY");
  });

  it("emits only env names the code actually reads", () => {
    const python = [
      read("packages", "agent", "src", "agent", "common", "credential_resolution.py"),
      read("packages", "knowledge-layer", "src", "ingest", "adapter.py"),
      read("packages", "knowledge-layer", "src", "embedding.py"),
    ].join("\n");
    for (const name of OPENROUTER_KEY_ENV) expect(python, name).toContain(`"${name}"`);
    expect(read("apps", "workspace", "bff", "model-config", "openrouter.ts")).toContain("process.env.OPENROUTER_API_KEY");
  });
});
