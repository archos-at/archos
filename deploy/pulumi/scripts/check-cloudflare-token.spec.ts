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
      '  "DELETE "*"/dns_records/probe1") [ -n "${STUB_DELETE_FAIL:-}" ] && echo \'{"success":false,"errors":[{"code":9,"message":"no"}]}\' || echo \'{"success":true,"result":{"id":"probe1"}}\' ;;',
      '  *"/entrypoint") printf "${STUB_ENTRY_CODE:-404}" ;;',
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

function run(args: string[], visible: string, stub: Record<string, string> = {}) {
  const r = spawnSync("bash", [SCRIPT, ...args], {
    env: { PATH: `${BIN}:${process.env.PATH}`, CLOUDFLARE_API_TOKEN: "t", STUB_VISIBLE: visible, ...stub },
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

  it("fails when the probe record cannot be deleted, so a leftover record is not a pass", () => {
    const r = run(["new.test"], "new.test", { STUB_DELETE_FAIL: "1" });
    expect(r.status).toBe(1);
    expect(r.out).toContain("could not delete it");
  });

  it("fails a refused redirect ruleset only on the zone whose baseline the stack owns", () => {
    // Prod's stack file sets dnsZoneBaseline; its dnsZoneName is the zone it writes the www rule to.
    const prodZone = readFileSync(join(__dirname, "..", "Pulumi.prod.yaml"), "utf8").match(/:dnsZoneName: *(\S+)/)![1];
    const owner = run(["--stack", "prod", "--read-only", prodZone], prodZone, { STUB_ENTRY_CODE: "403" });
    expect(owner.status).toBe(1);
    expect(owner.out).toContain("FAIL  redirect rules");
    const other = run(["--stack", "prod", "--read-only", "new.test"], "new.test", { STUB_ENTRY_CODE: "403" });
    expect(other.status).toBe(0);
    expect(other.out).toContain("WARN  redirect rules");
  });

  it("defaults to the brand's domain, prod's zone, and the stack's own and former zones, each once", () => {
    const read = (file: string) => readFileSync(join(__dirname, "..", file), "utf8");
    const key = (file: string, name: string) => new RegExp(`:${name}: *(\\S+)`).exec(read(file))?.[1];
    const brand = (JSON.parse(read("../../packages/brand/identity.json")) as { domain: string }).domain;
    const expected = [
      ...new Set([brand, key("Pulumi.prod.yaml", "dnsZoneName"), key("Pulumi.dev.yaml", "dnsZoneName"), key("Pulumi.dev.yaml", "formerDnsZoneName")]),
    ].filter((z): z is string => z !== undefined);
    const r = run(["--stack", "dev", "--read-only"], "none");
    expect(r.calls.filter((c) => c.includes("/zones?name="))).toEqual(
      expected.map((z) => `GET https://api.cloudflare.com/client/v4/zones?name=${z}`),
    );
  });
});
