import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { purgerEnv, type AppWiring } from "./config";

const here = __dirname;
const repoRoot = join(here, "..", "..", "..", "..");
const configSource = readFileSync(join(here, "config.ts"), "utf8");

function secretRef(env: ReturnType<typeof purgerEnv>, name: string) {
  const from = env.find((e) => e.name === name)?.valueFrom as
    | { secretKeyRef?: { name: string; key: string } }
    | undefined;
  return from?.secretKeyRef;
}

describe("purgerEnv", () => {
  const wiring = (langfuseEnabled: boolean) =>
    ({
      cfg: {
        observability: { enabled: false },
        seaweedfs: { accessKey: "a", bucket: "b" },
        langfuse: { enabled: langfuseEnabled },
      },
      seaweedInternalEndpoint: "http://seaweedfs:8333",
    }) as unknown as AppWiring;

  it("gives the purger Langfuse's API to delete an erased chat's traces", () => {
    const env = purgerEnv(wiring(true));
    expect(env.find((e) => e.name === "LANGFUSE_HOST")?.value).toBe("http://langfuse-web:3000");
    expect(secretRef(env, "LANGFUSE_PUBLIC_KEY")?.key).toBe("public-key");
    expect(secretRef(env, "LANGFUSE_SECRET_KEY")?.key).toBe("secret-key");
  });

  it("emits nothing about Langfuse without the tier", () => {
    expect(purgerEnv(wiring(false)).filter((e) => /LANGFUSE/.test(String(e.name)))).toEqual([]);
  });
});

describe("frontendEnv", () => {
  it("emits none of the retired feature switches", () => {
    for (const name of [
      "ENFORCE_FEATURE_FLAGS",
      "SKILLS_ENABLED",
      "COLLABORATION_ENABLED",
      "MAIL_IMPORT_ENABLED",
      "IFC_MODELS_ENABLED",
      "AGENT_AUTHORED_DOCUMENTS_ENABLED",
      "MEMORY_REFLECTION_ENABLED",
      "WORKFLOWS_ENABLED",
    ]) {
      expect(configSource).not.toContain(`name: "${name}"`);
    }
  });
});

describe("backendEnv extraction switches", () => {
  const adapterSource = readFileSync(
    join(repoRoot, "packages", "knowledge-layer", "src", "ingest", "adapter.py"),
    "utf8",
  );
  const switches = ["EXTRACT_TABLES", "EXTRACT_IMAGES", "EXTRACT_CHARTS"];

  it("sets none of them, so none can be left off by omission", () => {
    for (const name of switches) {
      expect(configSource).not.toContain(`"${name}"`);
    }
  });

  it("relies on the adapter reading each as on-unless-false", () => {
    for (const name of switches) {
      expect(adapterSource).toContain(`env_switch("${name}")`);
    }
  });
});
