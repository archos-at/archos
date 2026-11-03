import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "../test-support/stack-config";
import { mailStackConfig, SIGNING_KEY_ID, SIGNING_SECRET } from "../test-support/app-zone-config";
import { LEGACY_PROJECT } from "../names";

/**
 * Project mail on Cloudflare (`platform/inbound-mail.ts`).
 *
 * Every field below is a string the Cloudflare API accepts whatever it says: a
 * rule naming a script that does not exist, a binding under the wrong name,
 * routing enabled on a domain the rule does not cover. None of
 * those fail `pulumi up`; each one bounces or loses real mail. So the
 * assertions read the exact inputs sent.
 */

type Recorded = { type: string; name: string; inputs: Record<string, unknown> };
const RESOURCES: Recorded[] = [];
const CALLS: Array<{ token: string; inputs: Record<string, unknown> }> = [];

const ZONE_ID = "zone-mail-1";
const DOMAIN = "inbox.example.test";
const ZONE_NAME = "example.test";
const CONTRACT = JSON.parse(
  readFileSync(join(__dirname, "../../../../contracts/inbound-mail-contract.json"), "utf8"),
) as { path: string };

/** What the MX lookup answers; each test sets it before `install`. */
let MX_RECORDS: Array<{ name: string; content: string; type: string }> = [];

const CLOUDFLARE_MX = ["route1", "route2", "route3"].map((host) => ({
  name: DOMAIN,
  content: `${host}.mx.cloudflare.net`,
  type: "MX",
}));

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}-id`, state: args.inputs };
    },
    call: (args: pulumi.runtime.MockCallArgs) => {
      CALLS.push({ token: args.token, inputs: args.inputs });
      if (args.token === "cloudflare:index/getZone:getZone") {
        return { id: args.inputs.zoneId, name: ZONE_NAME, account: { id: "account-1", name: "Office" } };
      }
      if (args.token === "cloudflare:index/getDnsRecords:getDnsRecords") {
        return { results: MX_RECORDS };
      }
      return {};
    },
  },
  LEGACY_PROJECT,
  "test",
  false,
);

function mailConfig(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...baseStackConfig(),
    ...mailStackConfig(),
    [`${LEGACY_PROJECT}:observabilityEnabled`]: "false",
    [`${LEGACY_PROJECT}:baseDomain`]: "example.test",
    [`${LEGACY_PROJECT}:inboundMailDomain`]: DOMAIN,
    [`${LEGACY_PROJECT}:inboundMailZoneId`]: ZONE_ID,
    ...overrides,
  };
}

async function install(values: Record<string, string>, mx: typeof MX_RECORDS = []) {
  RESOURCES.length = 0;
  CALLS.length = 0;
  MX_RECORDS = mx;
  pulumi.runtime.setAllConfig(values);
  const { loadConfig } = await import("../config");
  const { installInboundMail } = await import("./inbound-mail");
  const { installInboundMailZone } = await import("./email-routing");
  const cfg = loadConfig();
  const result = installInboundMail(cfg, installInboundMailZone(cfg));
  if (result) {
    const ids = [result.zone.routing.id, result.rule.id, ...(result.script ? [result.script.id] : [])];
    await Promise.all(ids.map((id) => new Promise((resolve) => id.apply(resolve))));
  }
  return result;
}

const byType = (type: string) => RESOURCES.filter((r) => r.type === type);
const one = (type: string): Recorded => {
  const found = byType(type);
  expect(found, type).toHaveLength(1);
  return found[0];
};

const SCRIPT = "cloudflare:index/workersScript:WorkersScript";
const RULE = "cloudflare:index/emailRoutingRule:EmailRoutingRule";
const CATCH_ALL = "cloudflare:index/emailRoutingCatchAll:EmailRoutingCatchAll";
const SETTINGS = "cloudflare:index/emailRoutingSettings:EmailRoutingSettings";
const LITERAL = [{ type: "literal", field: "to", value: `project@${DOMAIN}` }];
const ROUTING = "cloudflare:index/emailRoutingDns:EmailRoutingDns";

type Binding = { name: string; type: string; text: string };

/** Pulumi's wire marker for a secret value, as the mock monitor receives it. */
const SECRET_SIG = "4dabf18193072939515e22adb298388d"; // pragma: allowlist secret (Pulumi secret-marker constant, not a credential)

/** Unwrap a mock input, reporting whether Pulumi marked it secret. */
function reveal(value: unknown): { secret: boolean; value: unknown } {
  if (typeof value === "object" && value !== null && SECRET_SIG in value && "value" in value) {
    return { secret: true, value: value.value };
  }
  return { secret: false, value };
}

describe("project mail on Cloudflare", () => {
  it("creates nothing when inboundMailDomain is unset", async () => {
    const result = await install(mailConfig({ [`${LEGACY_PROJECT}:inboundMailDomain`]: "" }));
    expect(result).toBeUndefined();
    expect(RESOURCES.filter((r) => r.type.startsWith("cloudflare:"))).toEqual([]);
    expect(CALLS).toEqual([]);
  });

  it("uploads the Worker module verbatim, into the zone's account", async () => {
    await install(mailConfig());
    const script = one(SCRIPT);
    expect(script.inputs.accountId).toBe("account-1");
    expect(script.inputs.scriptName).toBe("inbound-mail-test");
    expect(script.inputs.mainModule).toBe("inbound-mail-worker.js");
    expect(script.inputs.content).toBe(readFileSync(join(__dirname, "inbound-mail-worker.js"), "utf8"));
    // The module syntax Worker, not a service-worker script: that is the shape
    // whose default export's `email` handler Email Routing invokes.
    expect(script.inputs.content).toContain("async email(message, env)");
    expect(script.inputs.content).toContain(`INBOUND_MAIL_PATH = "${CONTRACT.path}"`);
    // The zone lookup is what gates the account id, i.e. the zone check ran.
    expect(CALLS.map((c) => c.token)).toContain("cloudflare:index/getZone:getZone");
  });

  it("switches Workers observability off explicitly", async () => {
    // Workers Logs would keep a record of every delivery at Cloudflare.
    await install(mailConfig());
    expect(one(SCRIPT).inputs.observability).toEqual({ enabled: false });
  });

  it("pins a compatibility date less than a year old", async () => {
    // The retry-on-throw behaviour the Worker relies on is undocumented
    // platform behaviour; a stale date is a decision nobody re-made (G8).
    const { COMPATIBILITY_DATE } = await import("./inbound-mail");
    await install(mailConfig());
    expect(one(SCRIPT).inputs.compatibilityDate).toBe(COMPATIBILITY_DATE);
    const ageDays = (Date.now() - Date.parse(`${COMPATIBILITY_DATE}T00:00:00Z`)) / 86_400_000;
    expect(ageDays, "bump COMPATIBILITY_DATE and re-run launch gates G1 and G2 (G8)").toBeLessThan(365);
  });

  it("binds the BFF origin, the key, the pause and the address shape under the names the Worker reads", async () => {
    await install(mailConfig());
    const bindings = reveal(one(SCRIPT).inputs.bindings);
    // The key makes the whole list a secret in state, which is the point.
    expect(bindings.secret).toBe(true);
    expect(bindings.value as Binding[]).toEqual([
      { name: "BFF_URL", type: "plain_text", text: "https://app.example.test" },
      { name: "SIGNING_KEY_ID", type: "plain_text", text: SIGNING_KEY_ID },
      // secret_text, never plain_text: a plain binding is readable by anyone
      // with Workers read access to the account.
      { name: "SIGNING_KEY", type: "secret_text", text: SIGNING_SECRET },
      { name: "PAUSED", type: "plain_text", text: "false" },
      { name: "ADDRESS_DOMAIN", type: "plain_text", text: DOMAIN },
      { name: "ADDRESS_LOCAL_PART", type: "plain_text", text: "project" },
    ]);
  });

  it("binds the configured local part", async () => {
    await install(mailConfig({ [`${LEGACY_PROJECT}:inboundMailLocalPart`]: "Projekt" }));
    const bindings = reveal(one(SCRIPT).inputs.bindings).value as Binding[];
    expect(bindings.find((b) => b.name === "ADDRESS_LOCAL_PART")?.text).toBe("projekt");
    expect(one(RULE).inputs.matchers).toEqual([{ type: "literal", field: "to", value: `projekt@${DOMAIN}` }]);
  });

  it("signs with the key the stack names during a rotation", async () => {
    const successor = Buffer.alloc(32, 0x22).toString("base64");
    await install(
      mailConfig({
        [`${LEGACY_PROJECT}:inboundMailSigningKeys`]: JSON.stringify({ [SIGNING_KEY_ID]: SIGNING_SECRET, "mi-2027-01": successor }),
        [`${LEGACY_PROJECT}:inboundMailSigningKeyId`]: "mi-2027-01",
      }),
    );
    const bindings = reveal(one(SCRIPT).inputs.bindings).value as Binding[];
    expect(bindings.find((b) => b.name === "SIGNING_KEY_ID")?.text).toBe("mi-2027-01");
    expect(bindings.find((b) => b.name === "SIGNING_KEY")?.text).toBe(successor);
  });

  it("passes the pause to the Worker", async () => {
    await install(mailConfig({ [`${LEGACY_PROJECT}:inboundMailPaused`]: "true" }));
    const bindings = reveal(one(SCRIPT).inputs.bindings).value as Binding[];
    expect(bindings.find((b) => b.name === "PAUSED")?.text).toBe("true");
  });

  it("enables Email Routing on the receiving subdomain itself, not the zone apex", async () => {
    await install(mailConfig());
    expect(one(ROUTING).inputs).toMatchObject({ zoneId: ZONE_ID, name: DOMAIN });
  });

  it("sends project@ and, through subaddressing, every project+<detail>@ to the Worker with ONE literal rule", async () => {
    await install(mailConfig());
    expect(one(RULE).inputs).toMatchObject({
      zoneId: ZONE_ID,
      enabled: true,
      matchers: LITERAL,
      actions: [{ type: "worker", values: ["inbound-mail-test"] }],
    });
  });

  it("declares no catch-all (apex-only) and no EmailRoutingSettings (its create onboards the apex)", async () => {
    await install(mailConfig());
    expect(byType(CATCH_ALL)).toEqual([]);
    expect(byType(SETTINGS)).toEqual([]);
  });

  it("reads the receiving domain's MX records before creating anything", async () => {
    await install(mailConfig());
    const lookup = CALLS.find((c) => c.token === "cloudflare:index/getDnsRecords:getDnsRecords");
    expect(lookup?.inputs).toMatchObject({ zoneId: ZONE_ID, type: "MX", name: { exact: DOMAIN } });
  });

  it.each([
    ["a fresh subdomain with no MX records (the first run)", []],
    ["a subdomain that holds only Cloudflare's MX (every later run)", CLOUDFLARE_MX],
    [
      "a subdomain whose apex receives mail at Google Workspace",
      [{ name: ZONE_NAME, content: "aspmx.l.google.com", type: "MX" }],
    ],
  ])("creates the routing on %s", async (_label, mx) => {
    await install(mailConfig(), mx);
    one(ROUTING);
    one(RULE);
  });

  it("uses a provider of its own, holding the configured token", async () => {
    await install(mailConfig());
    const provider = RESOURCES.find(
      (r) => r.type === "pulumi:providers:cloudflare" && r.name === "cloudflare-inbound-mail",
    );
    expect(reveal(provider?.inputs.apiToken)).toEqual({ secret: true, value: "cf-token" }); // pragma: allowlist secret
  });
});

describe("project mail, switched off (inboundMailEnabled: false)", () => {
  const off = () =>
    mailConfig({ [`${LEGACY_PROJECT}:inboundMailEnabled`]: "false", [`${LEGACY_PROJECT}:inboundMailSigningKeys`]: "" });

  it("keeps the rule, disabled, so Cloudflare refuses at SMTP time", async () => {
    // Disabled, not Drop: Drop accepts and discards, and the sender never
    // learns the mail was lost.
    const result = await install(off());
    expect(result?.script).toBeUndefined();
    expect(byType(SCRIPT)).toEqual([]);
    const rule = one(RULE);
    expect(rule.inputs).toMatchObject({ zoneId: ZONE_ID, enabled: false, matchers: LITERAL });
    expect(rule.inputs.actions).toEqual([{ type: "drop" }]);
    expect(JSON.stringify(rule.inputs)).not.toContain("inbound-mail-test");
  });

  it("is the same Pulumi resource as the live rule, so the switch is an update, not a delete", async () => {
    // Deleting the rule first would leave a window in which nothing names the
    // Worker's replacement; an in-place update never does.
    await install(mailConfig());
    const onName = one(RULE).name;
    await install(off());
    expect(one(RULE).name).toBe(onName);
  });

  it("keeps Email Routing on the domain", async () => {
    await install(off());
    one(ROUTING);
  });
});
