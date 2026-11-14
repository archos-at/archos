import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { RETIRED_VECTOR_KEYS } from './src/config/qdrant'
import { dmarcRecordProblem } from "./src/config/dmarc";
import { LEGACY_PROJECT } from "./src/names";

/**
 * The committed stack files, checked against EACH OTHER.
 *
 * `loadConfig` sees one stack at a time, so it cannot notice two stacks that
 * split a Cloudflare zone between them. That is how piloti.at kept redirecting
 * to dev.piloti.at after prod shipped: prod published the apex, while the dev
 * stack still owned www and the apex-redirect ruleset that answers at the edge
 * before prod's record is ever used. Every piece deployed cleanly.
 */

type StackConfig = Record<string, unknown>;

const DIR = __dirname;

function stacks(): Array<{ file: string; config: StackConfig }> {
  return readdirSync(DIR)
    .filter((f) => /^Pulumi\.[^.]+\.yaml$/.test(f))
    .map((file) => {
      const doc = load(readFileSync(join(DIR, file), "utf8")) as { config?: StackConfig };
      return { file, config: doc.config ?? {} };
    });
}

const str = (c: StackConfig, key: string): string | undefined => {
  const v = c[`grid-oib:${key}`];
  return typeof v === "string" ? v : undefined;
};

/** The stacks that manage records in each Cloudflare zone, keyed by zone id. */
function stacksByZone(): Map<string, Array<{ file: string; config: StackConfig }>> {
  const zones = new Map<string, Array<{ file: string; config: StackConfig }>>();
  for (const stack of stacks()) {
    const zoneId = str(stack.config, "dnsZoneId");
    if (str(stack.config, "dnsEnabled") !== "true" || zoneId === undefined) continue;
    zones.set(zoneId, [...(zones.get(zoneId) ?? []), stack]);
  }
  return zones;
}

describe("committed stack files", () => {
  it("leave the one-shot Chroma migration off, so the base-corpus sync and the vector reconcile run", () => {
    // Every stack has run it (prod 2026-10-18, dev before). Left on, it suspends both CronJobs:
    // on dev it did for weeks, and no corpus file was re-ingested (gotchas.md, "base-corpus files stay stale").
    for (const { file, config } of stacks()) {
      expect(str(config, "chromaMigration"), `${file} sets the Chroma migration flag`).toBeUndefined();
    }
  });

  it("finds the stacks it is meant to compare", () => {
    expect(stacks().map((s) => s.file)).toEqual(
      expect.arrayContaining(["Pulumi.dev.yaml", "Pulumi.prod.yaml"]),
    );
  });

  it("give each Cloudflare zone at most one baseline owner", () => {
    for (const [zoneId, members] of stacksByZone()) {
      const owners = members.filter((s) => str(s.config, "dnsZoneBaseline") === "true");
      const files = owners.map((s) => s.file).join(", ");
      expect(owners.length, `zone ${zoneId} is claimed by ${files}`).toBeLessThanOrEqual(1);
    }
  });

  it("leave no apex redirect standing once any stack in the zone serves the apex", () => {
    for (const [zoneId, members] of stacksByZone()) {
      const apexServers = members.filter((s) => {
        const web = str(s.config, "webDomain") ?? str(s.config, "baseDomain");
        return web === str(s.config, "dnsZoneName");
      });
      if (apexServers.length === 0) continue;
      const redirecting = members.filter((s) => str(s.config, "dnsApexRedirectTo") !== undefined);
      expect(redirecting.map((s) => s.file), `zone ${zoneId}`).toEqual([]);
    }
  });

  /**
   * The zone a stack's project mail routes on, as `loadConfig` resolves it:
   * `inboundMailZoneId`, or `dnsZoneId` when the domain is the app zone's
   * apex or a subdomain of it.
   */
  function inboundZone(config: StackConfig): string | undefined {
    const domain = str(config, "inboundMailDomain");
    if (domain === undefined) return undefined;
    const zoneName = str(config, "dnsZoneName");
    const inZone = zoneName !== undefined && (domain === zoneName || domain.endsWith(`.${zoneName}`));
    return str(config, "inboundMailZoneId") ?? (inZone ? str(config, "dnsZoneId") : undefined);
  }

  it("give each project-mail zone at most one stack", () => {
    // Email Routing's enablement is one object per zone (the provider keys it
    // by zone id), and its subaddressing setting is zone-wide. A second stack
    // on the same zone is no API error: the two fight over that state, and a
    // destroy of one could switch routing off for the other.
    const owners = new Map<string, string[]>();
    for (const stack of stacks()) {
      const zoneId = inboundZone(stack.config);
      if (zoneId === undefined) continue;
      owners.set(zoneId, [...(owners.get(zoneId) ?? []), stack.file]);
    }
    for (const [zoneId, files] of owners) {
      expect(files.length, `zone ${zoneId} is claimed by ${files.join(", ")}`).toBeLessThanOrEqual(1);
    }
  });

  it("run the malware scanner wherever project mail is configured", () => {
    // `loadConfig` refuses the pair at plan time (ADR-0157, ADR-0138); this
    // says so on the pull request instead.
    for (const stack of stacks()) {
      if (str(stack.config, "inboundMailDomain") === undefined) continue;
      expect(str(stack.config, "malwareScanEnabled"), stack.file).toBe("true");
    }
  });

  // A domain move keeps the former apex's records under the moving stack
  // (`formerBaseDomain`, platform/dns.ts). Another stack that still serves that
  // domain writes the same records, and Cloudflare lets the later `pulumi up`
  // overwrite the earlier one without a word.
  it("never let two stacks own the same domain, served or former", () => {
    const owners = new Map<string, string[]>();
    for (const stack of stacks()) {
      for (const key of ["baseDomain", "formerBaseDomain"]) {
        const domain = str(stack.config, key);
        if (domain !== undefined) owners.set(domain, [...(owners.get(domain) ?? []), `${stack.file} ${key}`]);
      }
    }
    for (const [domain, claims] of owners) expect(claims, domain).toHaveLength(1);
  });

  it("name the RFC 2142 forwards' mailbox wherever project mail is configured", () => {
    // `loadConfig` refuses the domain without it; this says so on the pull request.
    for (const stack of stacks()) {
      if (str(stack.config, "inboundMailDomain") === undefined) continue;
      expect(str(stack.config, "inboundMailOperatorAddress"), stack.file).toMatch(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i);
    }
  });

  it("publish only DMARC records that parse", () => {
    for (const stack of stacks()) {
      const record = str(stack.config, "inboundMailDmarc");
      if (record === undefined) continue;
      expect(dmarcRecordProblem(record), stack.file).toBeUndefined();
    }
  });

  it("give each zone's _dmarc one writer: the mail block or the DNS block, never both", () => {
    // `loadConfig` sees one stack. Across two, the DNS block of the stack that
    // owns a zone (`dnsZoneBaseline` with `dnsDmarc`) and another stack's mail
    // block on the same zone (`inboundMailDmarc`) would each write a TXT record
    // at `_dmarc`, Cloudflare would keep both, and receivers apply neither
    // (RFC 7489 §6.6.3). Compared by zone id: a mail zone of its own may be a
    // delegated child of the app zone's name. The preview's DMARC guard
    // (`email-routing.ts`) catches a record that no stack file shows.
    const dnsWriters = stacks().filter(
      (s) =>
        str(s.config, "dnsEnabled") === "true" &&
        str(s.config, "dnsZoneBaseline") === "true" &&
        str(s.config, "dnsDmarc") !== undefined,
    );
    for (const mail of stacks()) {
      const zoneId = inboundZone(mail.config);
      if (zoneId === undefined || str(mail.config, "inboundMailDmarc") === undefined) continue;
      const clash = dnsWriters.filter((s) => str(s.config, "dnsZoneId") === zoneId).map((s) => s.file);
      expect(clash, `${mail.file} publishes _dmarc on zone ${zoneId} with inboundMailDmarc`).toEqual([]);
    }
  });

  it("recommend, in prod's commented project-mail block, a DMARC record that parses", () => {
    // The owner uncomments the line at promotion 2; a typo found then is a
    // failed deploy. The placeholder stands for inboundMailOperatorAddress.
    const text = readFileSync(join(DIR, "Pulumi.prod.yaml"), "utf8");
    const line = new RegExp(`^ *# ${LEGACY_PROJECT}:inboundMailDmarc: *"(.*)"$`, "m").exec(text)?.[1];
    expect(line, "the commented inboundMailDmarc line").toBeDefined();
    const record = String(line).replace("<inboundMailOperatorAddress>", "mail-ops@company.example");
    expect(dmarcRecordProblem(record)).toBeUndefined();
    // `sp=` explicit: the receiving subdomain has no record of its own.
    expect(record).toMatch(/;\s*sp=/);
  });

  // `loadConfig` refuses them at plan time, which is the deploy failing; this
  // says so on the pull request instead (ADR-0115).
  it("set none of the retired Chroma and vector-switch keys", () => {
    for (const stack of stacks()) {
      const retired = RETIRED_VECTOR_KEYS.filter((key) => `grid-oib:${key}` in stack.config);
      expect(retired, stack.file).toEqual([]);
    }
  });
});

describe("the prod image pin the deploy verifies", () => {
  // deploy.yml's "Verify the pinned images exist" reads the tag with
  // `sed -n 's/^  grid-oib:imageTag: *//p'` before any Pulumi is installed. If
  // the pin moves or changes shape, that step fails closed; this says why
  // before a deploy does.
  it("is one immutable sha tag, on the line the deploy step reads", () => {
    const text = readFileSync(join(DIR, "Pulumi.prod.yaml"), "utf8");
    const pins = text
      .split("\n")
      .map((line) => /^  grid-oib:imageTag: *(.*)$/.exec(line)?.[1]?.replace(/["']/g, ""))
      .filter((tag): tag is string => tag !== undefined);
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatch(/^sha-[0-9a-f]{40}$/);
  });
});

describe("four-eyes review of platform knowledge", () => {
  // One operator alone (KNOWLEDGE_SINGLE_OPERATOR) is the dev stack's, by the owner's decision of 2026-11-11.
  // Prod keeps four eyes: its stack file never turns the switch on.
  it("is never switched off by the prod stack", () => {
    const prod = stacks().find((stack) => stack.file === "Pulumi.prod.yaml");
    expect(prod, "Pulumi.prod.yaml").toBeDefined();
    const value = prod?.config[`${LEGACY_PROJECT}:knowledgeSingleOperator`];
    expect(value === undefined || value === false || value === "false").toBe(true);
  });
  // The one exception, by the owner's decision of 2026-11-14 (ADR-0181): the promotion's carry Job sets it on its own
  // pod, to carry the releases dev reviewed. No other source under src/ turns it on.
  it("is turned on in source only by the knowledge carry Job", () => {
    const sources = (dir: string): string[] =>
      readdirSync(join(DIR, dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [join(dir, entry.name)] : [],
      );
    const setsIt = sources("src").filter((file) => /name: "KNOWLEDGE_SINGLE_OPERATOR", value: "true"/.test(readFileSync(join(DIR, file), "utf8")));
    expect(setsIt).toEqual([join("src", "app", "knowledge-carry-job.ts")]);
  });

  it("carries the reviewed releases on prod and on dev", () => {
    for (const file of ["Pulumi.prod.yaml", "Pulumi.dev.yaml"]) {
      expect(stacks().find((stack) => stack.file === file)?.config[`${LEGACY_PROJECT}:knowledgeCarry`], file).toBe("true");
    }
  });
});
