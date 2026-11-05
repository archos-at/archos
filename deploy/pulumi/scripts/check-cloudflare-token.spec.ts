import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The Cloudflare token check, run as an operator runs it: bash, real jq, and a
 * `curl` stub that answers per zone and records every call.
 *
 * Pinned: a zone the token cannot see fails with the fix and the exit code, a
 * visible zone prints the id the stack file needs, the write probe deletes what
 * it created, and --read-only writes nothing.
 */

const SCRIPT = join(__dirname, "check-cloudflare-token.sh");
const ROOT = mkdtempSync(join(tmpdir(), "check-cloudflare-token-"));
const BIN = join(ROOT, "bin");
const CALLS = join(ROOT, "curl-calls");
const ZONE_ID = "00000000000000000000000000abc123";

beforeAll(() => {
  mkdirSync(BIN, { recursive: true });
  // Answers by method and path. `STUB_VISIBLE` names the one zone the token sees.
  writeFileSync(
    join(BIN, "curl"),
    [
      "#!/usr/bin/env bash",
      'method=GET; url=""; out=""',
      'while [ $# -gt 0 ]; do case "$1" in -X) method="$2"; shift 2;; -o) out="$2"; shift 2;; -w|-H|--data) shift 2;; -*) shift;; *) url="$1"; shift;; esac; done',
      `printf '%s %s\\n' "$method" "$url" >> "${CALLS}"`,
      'case "$method $url" in',
      '  *"/user/tokens/verify") echo \'{"success":true,"result":{"status":"active"}}\' ;;',
      `  *"/zones?name=$STUB_VISIBLE") echo '{"success":true,"result":[{"id":"${ZONE_ID}","status":"active","account":{"name":"acme"},"name_servers":["a.ns","b.ns"]}]}' ;;`,
      '  *"/zones?name="*) echo \'{"success":true,"result":[]}\' ;;',
      '  "GET "*"/dns_records"*) echo \'{"success":true,"result":[{"type":"MX","name":"x","content":"mail","proxied":false}]}\' ;;',
      '  "POST "*"/dns_records") echo \'{"success":true,"result":{"id":"probe1"}}\' ;;',
      '  "DELETE "*"/dns_records/probe1") echo \'{"success":true,"result":{"id":"probe1"}}\' ;;',
      '  *"/entrypoint") printf 404 ;;',
      "esac",
    ].join("\n") + "\n",
    { mode: 0o755 },
  );
});

beforeEach(() => {
  if (existsSync(CALLS)) rmSync(CALLS);
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function run(args: string[], visible: string) {
  const r = spawnSync("bash", [SCRIPT, ...args], {
    env: { PATH: `${BIN}:${process.env.PATH}`, CLOUDFLARE_API_TOKEN: "t", STUB_VISIBLE: visible },
    encoding: "utf8",
  });
  const calls = existsSync(CALLS) ? readFileSync(CALLS, "utf8").trim().split("\n") : [];
  return { status: r.status, out: r.stdout + r.stderr, calls };
}

describe("check-cloudflare-token.sh", () => {
  it("prints the zone id and proves the write by deleting what it created", () => {
    const r = run(["new.test"], "new.test");
    expect(r.status).toBe(0);
    expect(r.out).toContain(`zone id ${ZONE_ID}`);
    expect(r.out).toContain("ok    DNS edit");
    const writes = r.calls.filter((c) => !c.startsWith("GET"));
    expect(writes).toEqual([
      `POST https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records`,
      `DELETE https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/probe1`,
    ]);
  });

  it("fails a zone the token cannot see, and says how to add it", () => {
    const r = run(["new.test", "old.test"], "old.test");
    expect(r.status).toBe(1);
    expect(r.out).toContain("FAIL  the token cannot see this zone");
    expect(r.out).toContain("Zone Resources: add new.test");
  });

  it("writes nothing with --read-only", () => {
    const r = run(["--read-only", "new.test"], "new.test");
    expect(r.status).toBe(0);
    expect(r.calls.every((c) => c.startsWith("GET"))).toBe(true);
  });

  it("defaults to the brand's domain and the zone prod serves today", () => {
    const r = run(["--read-only"], "none");
    expect(r.calls.filter((c) => c.includes("/zones?name=")).length).toBe(2);
  });
});
