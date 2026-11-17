import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KEDA_CHART_VERSION } from "../src/platform/keda";

export type Schema = Record<string, unknown>;
export type PlannedResource = { urn: string; inputs: Record<string, unknown> };
export type Step = { op: string; newState?: PlannedResource };
export type Plan = { steps: Step[] };

export const ROOT = mkdtempSync(join(__dirname, "..", ".validate-crs-test-"));
const KEDA_URL = `https://github.com/kedacore/keda/releases/download/v${KEDA_CHART_VERSION}/keda-${KEDA_CHART_VERSION}-crds.yaml`;
const CNPG_URL = "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/v1.28.0/releases/cnpg-1.28.0.yaml";

const string = { type: "string" };
const integer = { type: "integer" };
const object = (properties: Schema, required: string[] = []): Schema => ({
  type: "object", properties, required,
});
const array = (items: Schema): Schema => ({ type: "array", items });

function crd(group: string, kind: string, version: string, spec: Schema): Schema {
  return {
    kind: "CustomResourceDefinition",
    spec: {
      group,
      names: { kind },
      versions: [{
        name: version,
        storage: true,
        schema: { openAPIV3Schema: object({ apiVersion: string, kind: string, metadata: { type: "object" }, spec }, ["spec"]) },
      }],
    },
  };
}

export function kedaCrd(kind: string, version: string, spec: Schema): Schema {
  return crd("keda.sh", kind, version, spec);
}

export const kedaCrds = [
  crd("keda.sh", "TriggerAuthentication", "v1alpha1", object({
    secretTargetRef: array(object({ parameter: string, name: string, key: string }, ["parameter", "name", "key"])),
  })),
  crd("keda.sh", "ScaledObject", "v1alpha1", object({
    scaleTargetRef: object({ name: string }, ["name"]),
    minReplicaCount: integer,
    maxReplicaCount: integer,
    pollingInterval: integer,
    cooldownPeriod: integer,
    fallback: object({ failureThreshold: integer, replicas: integer, behavior: string }, ["failureThreshold", "replicas"]),
    advanced: { type: "object" },
    triggers: array(object({
      type: string,
      metricType: string,
      metadata: { type: "object", additionalProperties: string },
      authenticationRef: object({ name: string }, ["name"]),
    }, ["type"])),
  }, ["scaleTargetRef", "triggers"])),
];
const cnpgCrds = [
  crd("postgresql.cnpg.io", "Database", "v1", object({
    name: string,
    cluster: object({ name: string }, ["name"]),
  }, ["name", "cluster"])),
];

export function planOf(resources: PlannedResource[]): Plan {
  return structuredClone({ steps: resources.map((newState) => ({ op: "create", newState })) });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function replaceSpec(plan: Plan, kind: string, overrides: Schema): Plan {
  const inputs = plan.steps.find((step) => step.newState?.inputs.kind === kind)?.newState?.inputs;
  if (!inputs || !isRecord(inputs.spec)) throw new Error(`missing ${kind} spec`);
  inputs.spec = { ...inputs.spec, ...overrides };
  return plan;
}

export function workspace(): string {
  const dir = mkdtempSync(join(ROOT, "case-"));
  mkdirSync(join(dir, "scripts"));
  copyFileSync(join(__dirname, "validate-crs.mjs"), join(dir, "scripts", "validate-crs.mjs"));
  mkdirSync(join(dir, "src", "platform"), { recursive: true });
  copyFileSync(join(__dirname, "..", "src", "platform", "keda.ts"), join(dir, "src", "platform", "keda.ts"));
  copyFileSync(join(__dirname, "..", "src", "platform", "rabbitmq.ts"), join(dir, "src", "platform", "rabbitmq.ts"));
  writeFileSync(join(dir, "fetch.mjs"), `
import { readFileSync } from "node:fs";
const releases = JSON.parse(readFileSync(new URL("./releases.json", import.meta.url), "utf8"));
globalThis.fetch = async (url) => {
  console.error("FETCH " + url);
  if (!Object.hasOwn(releases, url)) throw new Error("unexpected schema URL " + url);
  if (process.env.TEST_SCHEMAS_FAILURE === "1") throw new Error("fixture network unavailable");
  return new Response(releases[url], { status: 200 });
};
`);
  return dir;
}

export function run(plan: Plan, options: {
  dir?: string;
  keda?: Schema[];
  env?: Record<string, string>;
} = {}) {
  const dir = options.dir ?? workspace();
  writeFileSync(join(dir, "plan.json"), JSON.stringify(plan));
  writeFileSync(join(dir, "releases.json"), JSON.stringify({
    [KEDA_URL]: (options.keda ?? kedaCrds).map((doc) => JSON.stringify(doc)).join("\n---\n"),
    [CNPG_URL]: cnpgCrds.map((doc) => JSON.stringify(doc)).join("\n---\n"),
  }));
  return spawnSync(process.execPath, [
    "--import", pathToFileURL(join(dir, "fetch.mjs")).href,
    join(dir, "scripts", "validate-crs.mjs"), join(dir, "plan.json"),
  ], {
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, ALLOW_SKIP: "", CNPG_SCHEMAS_OPTIONAL: "", ...options.env },
  });
}
