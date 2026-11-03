import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { purgerEnv, type AppWiring } from "./config";

const here = __dirname;
// src/app -> src -> deploy/pulumi -> deploy -> repo root
const repoRoot = join(here, "..", "..", "..", "..");
const configSource = readFileSync(join(here, "config.ts"), "utf8");

/** The Secret reference of an env var whose value is a plain (non-Output) literal in this block. */
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
    // Every feature is a WorkOS flag per organization now
    // (`apps/workspace/bff/authz/feature-flags.ts`). An env switch emitted
    // here would read as a lever and move nothing, which is how
    // `WORKFLOWS_ENABLED` once shipped a feature with no way to turn it on.
    // Read from source rather than by calling frontendEnv: it touches most of
    // DeployConfig, and a stub deep enough to call it would assert more about the
    // stub than about the program.
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

/**
 * Extraction is on because the CODE says so, not because a deployment
 * remembered a flag. Production once set only EXTRACT_IMAGES: uncaptioned
 * tables were indexed as garbled page text, and every raster the VLM typed as a
 * chart was analysed, paid for, and dropped. The rule is now "no flag set in a
 * deployment = on", which holds only while the adapter reads each flag as an
 * off-switch. Both halves are checked here, across the process boundary.
 */
describe("backendEnv extraction switches", () => {
  const adapterSource = readFileSync(
    join(repoRoot, "packages", "knowledge-layer", "src", "llamaindex", "adapter.py"),
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
