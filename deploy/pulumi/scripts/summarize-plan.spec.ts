import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markdown, summarize } from "./summarize-plan.mjs";

const urn = (type: string, name: string) => `urn:pulumi:dev::grid-oib::${type}::${name}`;

const plan = {
  steps: [
    { op: "same", urn: urn("kubernetes:apps/v1:Deployment", "web") },
    { op: "update", urn: urn("kubernetes:apps/v1:Deployment", "api"), diffReasons: ["spec"] },
    { op: "create", urn: urn("kubernetes:core/v1:ConfigMap", "extra") },
    { op: "create-replacement", urn: urn("kubernetes:batch/v1:Job", "migrate") },
    { op: "replace", urn: urn("kubernetes:batch/v1:Job", "migrate") },
    { op: "delete-replaced", urn: urn("kubernetes:batch/v1:Job", "migrate") },
  ],
};

const losingData = {
  steps: [...plan.steps, { op: "delete", urn: urn("kubernetes:core/v1:PersistentVolumeClaim", "qdrant-data") }],
};

function run(planJson: object, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "summarize-plan-"));
  const planPath = join(dir, "plan.json");
  const summaryPath = join(dir, "summary.md");
  writeFileSync(planPath, JSON.stringify(planJson));
  writeFileSync(summaryPath, "");
  const result = spawnSync("node", [join(__dirname, "summarize-plan.mjs"), planPath, summaryPath], {
    encoding: "utf8",
    env: { ...process.env, ALLOW_STATE_LOSS: "", ...env },
  });
  return { status: result.status, stdout: result.stdout, summary: readFileSync(summaryPath, "utf8") };
}

describe("summarize-plan", () => {
  it("counts each changed resource once, and a replacement as one replace", () => {
    const { byKind } = summarize(plan);
    expect(Object.fromEntries(Object.entries(byKind).map(([kind, list]) => [kind, list.length]))).toEqual({
      create: 1,
      update: 1,
      replace: 1,
      delete: 0,
    });
    expect(markdown(summarize(plan))).toContain("| 1 | 1 | 1 | 0 |");
  });

  it("passes a plan that replaces a Job, warns about it and writes the summary", () => {
    const { status, stdout, summary } = run(plan);
    expect(status).toBe(0);
    expect(stdout).toContain("::warning title=Pulumi plan::urn:pulumi:dev::grid-oib::kubernetes:batch/v1:Job::migrate is replaced");
    expect(summary).toContain("Pulumi preview against staging");
  });

  it("fails a plan that deletes a volume claim, naming it", () => {
    const { status, stdout, summary } = run(losingData);
    expect(status).toBe(1);
    expect(stdout).toContain("::error title=Pulumi plan::urn:pulumi:dev::grid-oib::kubernetes:core/v1:PersistentVolumeClaim::qdrant-data holds data");
    expect(summary).toContain("infra:destroys-state");
  });

  it("lets the infra:destroys-state label accept the loss", () => {
    expect(run(losingData, { ALLOW_STATE_LOSS: "1" }).status).toBe(0);
  });
});
