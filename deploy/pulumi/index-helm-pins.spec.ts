import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as pulumi from "@pulumi/pulumi";
import ts from "typescript";
import { baseStackConfig, ciRunnersStackConfig } from "./src/test-support/stack-config";

const RELEASE = "kubernetes:helm.sh/v3:Release";
const CLUSTER = "kubernetes:postgresql.cnpg.io/v1:Cluster";

type Resource = { type: string; name: string; inputs: Record<string, any> };
const RESOURCES: Resource[] = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
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

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name.startsWith(".") ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [path] : [];
  });
}

function helmConstructions(file: string): number {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node) && /^k8s\.helm\.v\d+\.(Release|Chart)$/.test(node.expression.getText(source))) count++;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

describe("every Helm chart the program installs is pinned", () => {
  beforeAll(async () => {
    pulumi.runtime.setAllConfig({
      ...baseStackConfig(),
      ...ciRunnersStackConfig(),
      "grid-oib:installMetricsServer": "true",
      "grid-oib:observabilityEnabled": "false",
    });
    const stack = (await import("./index")) as Record<string, unknown>;
    await Promise.all(
      Object.values(stack)
        .filter((v): v is pulumi.Output<unknown> => pulumi.Output.isInstance(v))
        .map((output) => new Promise((resolve) => output.apply(resolve))),
    );
  }, 120_000);

  const releases = () => RESOURCES.filter((r) => r.type === RELEASE);

  it("renders every Helm release the source declares, so none escapes the pin check", () => {
    const declared = sourceFiles(join(__dirname, "src"))
      .concat(join(__dirname, "index.ts"))
      .reduce((count, file) => count + helmConstructions(file), 0);
    expect(declared).toBeGreaterThan(0);
    expect(releases().length).toBe(declared);
  });

  it("gives each release an exact chart version, never a range or the repository's latest", () => {
    for (const release of releases()) {
      expect(release.inputs.version, release.name).toMatch(/^v?\d+\.\d+\.\d+$/);
    }
  });

  it("installs each chart at its exported constant", async () => {
    const { CNPG_CHART_VERSION } = await import("./src/data/postgres");
    const { CERT_MANAGER_CHART_VERSION } = await import("./src/platform/cert-manager");
    const { ENVOY_GATEWAY_CHART_VERSION } = await import("./src/platform/gateway");
    const { METRICS_SERVER_CHART_VERSION } = await import("./src/platform/metrics-server");
    const { KEDA_CHART_VERSION } = await import("./src/platform/keda");
    const { HATCHET_CHART_VERSION } = await import("./src/config/background-work");
    const { ARC_CHART_VERSION } = await import("./src/platform/ci-runners");

    const versions = Object.fromEntries(releases().map((r) => [r.name, r.inputs.version]));
    expect(versions).toEqual({
      "cloudnative-pg": CNPG_CHART_VERSION,
      "cert-manager": CERT_MANAGER_CHART_VERSION,
      "envoy-gateway": ENVOY_GATEWAY_CHART_VERSION,
      "metrics-server": METRICS_SERVER_CHART_VERSION,
      keda: KEDA_CHART_VERSION,
      hatchet: HATCHET_CHART_VERSION,
      "arc-controller": ARC_CHART_VERSION,
      "arc-scale-set": ARC_CHART_VERSION,
    });
  });
});

describe("a CloudNativePG operator upgrade", () => {
  it("swaps the instance manager in place instead of rolling every Postgres instance", () => {
    const operator = RESOURCES.find((r) => r.type === RELEASE && r.name === "cloudnative-pg")!;
    expect(operator.inputs.values.config.data).toEqual({ ENABLE_INSTANCE_MANAGER_INPLACE_UPDATES: "true" });
  });

  it("hands each cluster's primary to a replica rather than restarting it in place", () => {
    const clusters = RESOURCES.filter((r) => r.type === CLUSTER);
    expect(clusters.length).toBeGreaterThan(0);
    for (const cluster of clusters) {
      expect(cluster.inputs.spec.primaryUpdateMethod, cluster.name).toBe("switchover");
      expect(cluster.inputs.spec.primaryUpdateStrategy, cluster.name).toBe("unsupervised");
    }
  });
});
