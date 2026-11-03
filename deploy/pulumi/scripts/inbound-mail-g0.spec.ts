import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { DEFAULT_INBOUND_MAIL_LOCAL_PART } from "../src/config/inbound-mail";
import {
  apexMxFinding,
  classifyDomainRules,
  expectedApexMx,
  g0Findings,
  localPartFromEnv,
  mxHostsFromDoh,
  probeAddress,
  receivingMxFinding,
  ruleFindings,
  subaddressFinding,
  testMailSteps,
  type Rule,
} from "./inbound-mail-g0";

/**
 * Gate G0's read-only check (`scripts/inbound-mail-g0.ts`, run as
 * `inbound-mail-smoke.ts g0`). What is pinned: that a pass means what the
 * runbook says it means. The live answers of Cloudflare and DNS are never
 * fetched here; `g0Findings` runs on canned ones.
 */

const DOMAIN = "inbox.example.org";
const LOCAL = "project";
const CF_MX = ["route1.mx.cloudflare.net", "route2.mx.cloudflare.net", "route3.mx.cloudflare.net"];

const literal = (address: string, action: Rule["actions"], enabled = true): Rule => ({
  enabled,
  matchers: [{ type: "literal", field: "to", value: address }],
  actions: action,
});
const projectRule = literal(`${LOCAL}@${DOMAIN}`, [{ type: "worker", value: ["inbound-mail-prod"] }]);
const forwards = ["postmaster", "abuse"].map((l) => literal(`${l}@${DOMAIN}`, [{ type: "forward", value: ["ops@example.org"] }]));
const apexRule = literal("info@example.org", [{ type: "forward", value: ["ops@example.org"] }]);

describe("the MX answers", () => {
  it("reads the hosts out of a DNS-over-HTTPS answer, lowercased and without the root dot", () => {
    const answer = {
      Status: 0,
      Answer: [
        { type: 15, data: "86 Route2.MX.cloudflare.net." },
        { type: 5, data: "alias.example.org." },
        { type: 15, data: "10 route1.mx.cloudflare.net." },
      ],
    };
    expect(mxHostsFromDoh(answer)).toEqual(["route1.mx.cloudflare.net", "route2.mx.cloudflare.net"]);
  });

  it("reads NXDOMAIN as no MX, and refuses a failed lookup rather than reading it as none", () => {
    expect(mxHostsFromDoh({ Status: 3 })).toEqual([]);
    expect(() => mxHostsFromDoh({ Status: 2 })).toThrow(/status 2/);
  });

  it("passes the receiving domain only when every MX is Cloudflare's", () => {
    expect(receivingMxFinding(DOMAIN, CF_MX).status).toBe("pass");
    expect(receivingMxFinding(DOMAIN, []).status).toBe("fail");
    expect(receivingMxFinding(DOMAIN, [...CF_MX, "smtp.google.com"]).status).toBe("fail");
  });

  it("fails the apex the moment Cloudflare's MX appear on it, unless that was chosen", () => {
    expect(apexMxFinding("example.org", ["route1.mx.cloudflare.net"]).status).toBe("fail");
    expect(apexMxFinding("example.org", ["route1.mx.cloudflare.net"], []).status).toBe("fail");
  });

  it("passes Cloudflare's MX on the apex only when the onboarding was chosen", () => {
    expect(apexMxFinding("example.org", ["route1.mx.cloudflare.net"], "cloudflare").status).toBe("pass");
    expect(apexMxFinding("example.org", [], "cloudflare").status).toBe("fail");
    expect(apexMxFinding("example.org", ["route1.mx.cloudflare.net", "smtp.google.com"], "cloudflare").status).toBe("fail");
  });

  it("holds the apex to the expected set when one is given, none included", () => {
    expect(apexMxFinding("example.org", ["smtp.google.com"], ["SMTP.google.com."]).status).toBe("pass");
    expect(apexMxFinding("example.org", ["aspmx.l.google.com"], ["smtp.google.com"]).status).toBe("fail");
    expect(apexMxFinding("example.org", [], []).status).toBe("pass");
    expect(apexMxFinding("example.org", ["smtp.google.com"], []).status).toBe("fail");
    expect(apexMxFinding("example.org", ["smtp.google.com"]).status).toBe("pass");
  });

  it("reads INBOUND_MAIL_APEX_MX as unset, none, or a host list", () => {
    expect(expectedApexMx(undefined)).toBeUndefined();
    expect(expectedApexMx(" ")).toBeUndefined();
    expect(expectedApexMx("None")).toEqual([]);
    expect(expectedApexMx("Cloudflare")).toBe("cloudflare");
    expect(expectedApexMx("smtp.google.com., aspmx.l.google.com")).toEqual(["smtp.google.com", "aspmx.l.google.com"]);
  });
});

describe("the zone's settings and rules", () => {
  it("passes subaddressing only when Cloudflare says true", () => {
    expect(subaddressFinding({ support_subaddress: true }).status).toBe("pass");
    expect(subaddressFinding({ support_subaddress: false }).status).toBe("fail");
    expect(subaddressFinding({}).status).toBe("fail");
  });

  it("sorts the domain's rules and ignores the apex's", () => {
    const sorted = classifyDomainRules([apexRule, projectRule, ...forwards], DOMAIN, LOCAL);
    expect(sorted.project).toBe(projectRule);
    expect(sorted.rfc2142.map(([local, rule]) => [local, rule !== undefined])).toEqual([
      ["postmaster", true],
      ["abuse", true],
    ]);
    expect(sorted.others).toEqual([]);
  });

  it("passes the project rule, the two forwards and nothing else", () => {
    const findings = ruleFindings([projectRule, ...forwards, apexRule], DOMAIN, LOCAL, "inbound-mail-prod");
    expect(findings.map((f) => f.status)).toEqual(["pass", "pass", "pass"]);
  });

  it("fails a disabled project rule, a rule to another Worker, and a Drop", () => {
    const disabled = literal(`${LOCAL}@${DOMAIN}`, projectRule.actions, false);
    const other = literal(`${LOCAL}@${DOMAIN}`, [{ type: "worker", value: ["inbound-mail-dev"] }]);
    const drop = literal(`${LOCAL}@${DOMAIN}`, [{ type: "drop" }]);
    for (const rule of [disabled, other, drop]) {
      expect(ruleFindings([rule, ...forwards], DOMAIN, LOCAL, "inbound-mail-prod")[0].status).toBe("fail");
    }
  });

  it("fails a missing or non-forwarding RFC 2142 address", () => {
    const toWorker = literal(`abuse@${DOMAIN}`, [{ type: "worker", value: ["inbound-mail-prod"] }]);
    expect(ruleFindings([projectRule, forwards[0]], DOMAIN, LOCAL)[1]).toMatchObject({ status: "fail", detail: expect.stringContaining(`abuse@${DOMAIN}`) });
    expect(ruleFindings([projectRule, forwards[0], toWorker], DOMAIN, LOCAL)[1].status).toBe("fail");
  });

  it("fails any other rule on the receiving domain, a leftover G2 rule included", () => {
    const leftover = literal(`${LOCAL}+site.k3m7q2xw4pab@${DOMAIN}`, [{ type: "worker", value: ["gate"] }]);
    const findings = ruleFindings([projectRule, ...forwards, leftover], DOMAIN, LOCAL);
    expect(findings[2]).toMatchObject({ status: "fail", detail: `${LOCAL}+site.k3m7q2xw4pab@${DOMAIN}` });
  });
});

describe("the test mail", () => {
  it("is mailed to a project-shaped address of no project", () => {
    expect(probeAddress(LOCAL, DOMAIN)).toBe(`project+smoke.aaaaaaaaaaaa@${DOMAIN}`);
  });

  it("names the pass, the stop and the config error for the state the Worker is in", () => {
    const paused = testMailSteps(LOCAL, DOMAIN, true);
    expect(paused).toContain("NO bounce now");
    expect(paused).toContain("Address does not exist");
    expect(paused).toContain("Unknown address: this message was not delivered.");
    expect(testMailSteps(LOCAL, DOMAIN, false)).toContain("NOT paused");
  });

  it("defaults the local part to the program's own", () => {
    expect(localPartFromEnv({})).toBe(DEFAULT_INBOUND_MAIL_LOCAL_PART);
    expect(localPartFromEnv({ INBOUND_MAIL_LOCAL_PART: " Mail " })).toBe("mail");
  });
});

describe("g0Findings", () => {
  it("runs every check on canned answers and puts the test mail last", async () => {
    const answers: Record<string, unknown> = {
      "/zones/z1": { name: "example.org" },
      "/zones/z1/email/routing": { enabled: false, status: "unconfigured", support_subaddress: true },
      "/zones/z1/email/routing/rules?per_page=50": [projectRule, ...forwards],
    };
    const env = (name: string) => ({ INBOUND_MAIL_ZONE_ID: "z1", INBOUND_MAIL_DOMAIN: DOMAIN })[name] ?? "";
    const before = process.env.INBOUND_MAIL_LOCAL_PART;
    process.env.INBOUND_MAIL_LOCAL_PART = LOCAL;
    try {
      const findings = await g0Findings({
        cloudflareApi: async (path) => answers[path],
        env,
        mx: async (name) => (name === DOMAIN ? CF_MX : ["smtp.google.com"]),
      });
      expect(findings.filter((f) => f.status === "fail")).toEqual([]);
      expect(findings.at(-1)).toMatchObject({ status: "manual", name: "the test mail" });
      expect(findings.find((f) => f.name.startsWith("Email Routing on the zone"))?.status).toBe("info");
    } finally {
      if (before === undefined) delete process.env.INBOUND_MAIL_LOCAL_PART;
      else process.env.INBOUND_MAIL_LOCAL_PART = before;
    }
  });
});

describe("the command line", () => {
  it("stops on a missing input rather than guessing one", () => {
    const result = spawnSync("bun", [join(__dirname, "inbound-mail-smoke.ts"), "g0"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/is not set/);
  });
});
