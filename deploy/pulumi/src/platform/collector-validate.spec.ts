import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig, langfuseStackConfig } from "../test-support/stack-config";

const OTELCOL_BIN = process.env.OTELCOL_BIN;

const RESOURCES: Array<{ type: string; name: string; inputs: Record<string, unknown> }> = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}-id`, state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } } };
    },
    call: () => ({}),
  },
  "grid-oib",
  "test",
  false,
);

function resolve<T>(value: unknown): Promise<T> {
  return new Promise((done) => (pulumi.output(value) as pulumi.Output<T>).apply((v) => (done(v), v)));
}

async function renderedConfigs(values: Record<string, string>): Promise<Record<string, string>> {
  vi.resetModules();
  RESOURCES.length = 0;
  pulumi.runtime.setAllConfig({ ...baseStackConfig(), ...values });
  await import("../../index");
  await new Promise((r) => setTimeout(r, 200));
  const configs: Record<string, string> = {};
  for (const r of RESOURCES.filter((r) => r.type === "kubernetes:core/v1:ConfigMap")) {
    const data = await resolve<Record<string, string> | undefined>(r.inputs.data);
    if (data?.["collector.yaml"]) configs[r.name] = data["collector.yaml"];
  }
  return configs;
}

function outsideThePod(yaml: string): string {
  return yaml.split("auth_type: serviceAccount").join("auth_type: none");
}

const STACKS: Record<string, Record<string, string>> = {
  "the defaults (PostHog on, Qdrant on)": {},
  "Langfuse and PostHog both on": langfuseStackConfig(),
  "Langfuse with PostHog opted out": { ...langfuseStackConfig(), "grid-oib:posthogHost": "" },
};

describe.skipIf(!OTELCOL_BIN)("every rendered collector config passes `otelcol-contrib validate`", () => {
  const rendered: Array<[string, string, string]> = [];

  beforeAll(async () => {
    for (const [stack, values] of Object.entries(STACKS)) {
      for (const [name, yaml] of Object.entries(await renderedConfigs(values))) rendered.push([stack, name, yaml]);
    }
  }, 240_000);

  it("renders at least one config per stack", () => {
    expect(new Set(rendered.map(([stack]) => stack))).toEqual(new Set(Object.keys(STACKS)));
  });

  it("is accepted by the pinned collector build", () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-validate-"));
    const failures: string[] = [];
    for (const [index, [stack, name, yaml]] of rendered.entries()) {
      const file = join(dir, `${index}-${name}.yaml`);
      writeFileSync(file, outsideThePod(yaml));
      try {
        execFileSync(OTELCOL_BIN!, ["validate", `--config=${file}`], {
          env: { ...process.env, LANGFUSE_OTLP_AUTH: "Basic placeholder", K8S_NODE_NAME: "node-0" },
          stdio: "pipe",
        });
      } catch (error) {
        const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
        failures.push(`${stack} / ${name}:\n${stderr}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
