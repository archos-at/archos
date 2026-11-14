import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The prod downgrade guard, run as deploy.yml's prod job runs it: bash, a real
 * git history, and stubs for `pulumi` (the running images) and `gh` (a commit
 * date the checkout does not have).
 *
 * The case it exists for: develop's Pulumi.prod.yaml carried a September pin
 * into the November promotion, and prod ran a commit no branch has any more
 * (a history rewrite), so ancestry alone could not have refused it.
 */

const SCRIPT = join(__dirname, "prod-downgrade-guard.sh");
const ROOT = mkdtempSync(join(tmpdir(), "prod-downgrade-guard-"));
const REPO = join(ROOT, "repo");
const BIN = join(ROOT, "bin");
const C: Record<string, string> = {};
/** A commit no ref holds, as prod's rewritten sha-331b9d91… was. */
const GONE = "331b9d9117661b201c762a7017f9c0d17ec21866";

const GIT_ENV = {
  ...process.env,
  HOME: ROOT,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
};

function git(args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", args, { cwd: REPO, env: { ...GIT_ENV, ...env }, encoding: "utf8" }).trim();
}

function commit(name: string, date: string): void {
  git(["commit", "--allow-empty", "-q", "-m", name], { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date });
  C[name] = git(["rev-parse", "HEAD"]);
}

function stub(name: string, body: string): void {
  const path = join(BIN, name);
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
}

beforeAll(() => {
  execFileSync("mkdir", ["-p", REPO, BIN]);
  git(["init", "-q", "-b", "develop"]);
  commit("september", "2026-09-18T10:00:00Z");
  commit("october", "2026-10-28T19:02:43Z");
  commit("november", "2026-11-10T12:00:00Z");
  // The rewritten twin of `october`: same date, on no shared history.
  git(["checkout", "-q", "--orphan", "rewritten"]);
  commit("twin", "2026-10-28T19:02:43Z");
  git(["checkout", "-q", "develop"]);

  // `pulumi stack output deployedImages --json` prints $STUB_DEPLOYED.
  stub("pulumi", ['[ "$1 $2 $3" = "stack output deployedImages" ] || exit 64', 'printf \'%s\' "${STUB_DEPLOYED:-}"'].join("\n"));
  // `gh api repos/<repo>/commits/<sha>` answers $STUB_GH_DATE, or fails when it is empty.
  stub("gh", ['[ -n "${STUB_GH_DATE:-}" ] || exit 1', 'printf \'%s\\n\' "$STUB_GH_DATE"'].join("\n"));
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

const tag = (sha: string) => `sha-${sha}`;
const runs = (sha: string) =>
  JSON.stringify(
    Object.fromEntries(["backend", "frontend", "web"].map((s) => [s, `ghcr.io/archos-at/${s}:${tag(sha)}`])),
  );

function guard(pinnedSha: string, env: Record<string, string>) {
  const result = spawnSync("bash", [SCRIPT, tag(pinnedSha)], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...GIT_ENV, PATH: `${BIN}:${process.env.PATH ?? ""}`, GITHUB_REPOSITORY: "archos-at/archos", ...env },
  });
  return { status: result.status, stderr: result.stderr };
}

describe("prod-downgrade-guard.sh", () => {
  it("lets a pin through that descends from what prod runs", () => {
    const out = guard(C.november, { STUB_DEPLOYED: runs(C.october) });
    expect(out.status, out.stderr).toBe(0);
  });

  it("lets the running pin through again", () => {
    expect(guard(C.october, { STUB_DEPLOYED: runs(C.october) }).status).toBe(0);
  });

  it("refuses a pin that is an ancestor of what prod runs", () => {
    const out = guard(C.september, { STUB_DEPLOYED: runs(C.october) });
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("refusing to downgrade prod");
    expect(out.stderr).toContain(`imageTag=${tag(C.september)}`);
  });

  it("compares commit dates when prod runs a commit no branch has, read from the API", () => {
    const deployed = { STUB_DEPLOYED: runs(GONE), STUB_GH_DATE: "2026-10-28T19:02:43Z" };
    expect(guard(C.november, deployed).status).toBe(0);
    const back = guard(C.september, deployed);
    expect(back.status).toBe(1);
    expect(back.stderr).toContain("was committed earlier");
  });

  it("allows the rewritten twin of the running commit, which has its date", () => {
    expect(guard(C.october, { STUB_DEPLOYED: runs(C.twin) }).status).toBe(0);
    expect(guard(C.september, { STUB_DEPLOYED: runs(C.twin) }).status).toBe(1);
  });

  it("fails closed when the running commit's date cannot be read", () => {
    const out = guard(C.november, { STUB_DEPLOYED: runs(GONE), STUB_GH_DATE: "" });
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("could not be read");
  });

  it("warns and lets a first deploy through, which has nothing recorded", () => {
    const out = guard(C.november, { STUB_DEPLOYED: "" });
    expect(out.status).toBe(0);
    expect(out.stderr).toContain("::warning::");
  });
});
