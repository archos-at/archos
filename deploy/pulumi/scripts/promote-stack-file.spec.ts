import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The stack file a promotion to prod carries (promote.yml): develop's, with
 * the lines prod changed on its own branch since the last promotion, and the
 * new pin. The trap it closes: develop's copy pins whatever the last promotion
 * left there, so taking it whole rolled prod back two months.
 */

const SCRIPT = join(__dirname, "promote-stack-file.sh");
const DIR = mkdtempSync(join(tmpdir(), "promote-stack-file-"));
const PIN = `sha-${"b".repeat(40)}`;

afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const file = (lines: Record<string, string>) =>
  ["config:", ...Object.entries(lines).flatMap(([k, v]) => [`  # ${k}`, `  workspace:${k}: ${v}`]), ""].join("\n");

const BASE = {
  imageTag: `sha-${"9".repeat(40)}`,
  seaweedfsStorageSize: "20Gi",
  mcpGatewayEnabled: '"true"',
  cmsEnabled: '"false"',
};

function promote(develop: Record<string, string>, prod: Record<string, string>, tag = PIN) {
  const paths = { base: join(DIR, "base"), develop: join(DIR, "develop"), prod: join(DIR, "prod") };
  writeFileSync(paths.base, file(BASE));
  writeFileSync(paths.develop, file(develop));
  writeFileSync(paths.prod, file(prod));
  const r = spawnSync("bash", [SCRIPT, paths.base, paths.develop, paths.prod, tag], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("promote-stack-file.sh", () => {
  it("keeps develop's changes, carries prod's own, and sets the pin", () => {
    const out = promote(
      { ...BASE, seaweedfsStorageSize: "200Gi" },
      { ...BASE, imageTag: `sha-${"3".repeat(40)}`, mcpGatewayEnabled: '"false"' },
    );
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toBe(
      file({ ...BASE, imageTag: PIN, seaweedfsStorageSize: "200Gi", mcpGatewayEnabled: '"false"' }),
    );
  });

  it("never takes develop's stale pin, even when develop moved it too", () => {
    const out = promote({ ...BASE, imageTag: `sha-${"7".repeat(40)}` }, { ...BASE, imageTag: `sha-${"3".repeat(40)}` });
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain(`  workspace:imageTag: ${PIN}\n`);
  });

  it("stops on a line both sides changed", () => {
    const out = promote({ ...BASE, cmsEnabled: '"true"' }, { ...BASE, cmsEnabled: "off" });
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("changed the same lines");
  });

  it("refuses a pin that is not a full sha tag", () => {
    expect(promote(BASE, BASE, "latest").status).toBe(1);
  });
});
