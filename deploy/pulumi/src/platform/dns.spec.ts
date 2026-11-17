import { describe, it, expect, beforeEach } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { hostsOutsideZone, managedHosts, TTL_AUTOMATIC, UNROUTABLE_PLACEHOLDER } from "./dns";
import { baseStackConfig } from "../test-support/stack-config";

const RESOURCES: Array<{ type: string; name: string; inputs: Record<string, unknown> }> = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}-id`, state: args.inputs };
    },
    call: () => ({}),
  },
  "grid-oib",
  "test",
  false,
);

const ZONE = "example.test";

const KEY = (name: string) => `${pulumi.getProject()}:${name}`;

type RedirectRule = {
  expression: string;
  actionParameters: { fromValue: { statusCode: number; targetUrl: { value: string } } };
};

type WwwRedirectRule = {
  expression: string;
  actionParameters: { fromValue: { statusCode: number; targetUrl: { expression: string } } };
};

function dnsConfig(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...baseStackConfig(),
    "grid-oib:observabilityEnabled": "false",
    "grid-oib:baseDomain": `dev.${ZONE}`,
    "grid-oib:loadBalancerIp": "203.0.113.10",
    "grid-oib:dnsEnabled": "true",
    "grid-oib:dnsZoneId": "00000000000000000000000000abc123",
    "grid-oib:dnsZoneName": ZONE,
    "grid-oib:cloudflareApiToken": "cf-token", // pragma: allowlist secret
    ...overrides,
  };
}

async function install(values: Record<string, string>) {
  RESOURCES.length = 0;
  pulumi.runtime.setAllConfig(values);
  const { loadConfig } = await import("../config");
  const { installDns } = await import("./dns");
  const result = installDns(loadConfig());
  if (result) {
    await Promise.all(
      [...result.hostRecords, ...result.formerHostRecords, ...result.baselineRecords].map(
        (r) => new Promise((resolve) => r.name.apply(resolve)),
      ),
    );
    if (result.apexRedirect) {
      await new Promise((resolve) => result.apexRedirect!.ruleset.name.apply(resolve));
    }
    if (result.wwwRedirect) {
      await new Promise((resolve) => result.wwwRedirect!.name.apply(resolve));
    }
  }
  return { result, records: RESOURCES.filter((r) => r.type.endsWith(":DnsRecord")) };
}

async function loadWith(values: Record<string, string>): Promise<Error | null> {
  pulumi.runtime.setAllConfig(values);
  const { loadConfig } = await import("../config");
  try {
    loadConfig();
    return null;
  } catch (error) {
    return error as Error;
  }
}

describe("managedHosts", () => {
  it("mirrors the Gateway's HTTPS listeners, langfuse included only when its tier is on", () => {
    const base = { webDomain: "d.test", appDomain: "app.d.test", s3Domain: "s3.d.test" };
    expect(managedHosts(base)).toEqual(["d.test", "app.d.test", "s3.d.test"]);
    expect(managedHosts({ ...base, langfuseDomain: "langfuse.d.test" })).toEqual([
      "d.test",
      "app.d.test",
      "s3.d.test",
      "langfuse.d.test",
    ]);
  });

  it("adds the Qdrant dashboard host after langfuse, in listener order, only when given", () => {
    const base = { webDomain: "d.test", appDomain: "app.d.test", s3Domain: "s3.d.test" };
    expect(managedHosts({ ...base, qdrantDashboardDomain: undefined })).toEqual(["d.test", "app.d.test", "s3.d.test"]);
    expect(
      managedHosts({ ...base, langfuseDomain: "langfuse.d.test", qdrantDashboardDomain: "qdrant.d.test" }),
    ).toEqual(["d.test", "app.d.test", "s3.d.test", "langfuse.d.test", "qdrant.d.test"]);
  });

  it("adds the CMS host last, in listener order, only when given (ADR-0155)", () => {
    const base = { webDomain: "d.test", appDomain: "app.d.test", s3Domain: "s3.d.test" };
    expect(managedHosts({ ...base, cmsDomain: undefined })).toEqual(["d.test", "app.d.test", "s3.d.test"]);
    expect(managedHosts({ ...base, qdrantDashboardDomain: "qdrant.d.test", cmsDomain: "cms.d.test" })).toEqual([
      "d.test",
      "app.d.test",
      "s3.d.test",
      "qdrant.d.test",
      "cms.d.test",
    ]);
  });
});

describe("hostsOutsideZone", () => {
  it("accepts the apex and anything under it", () => {
    expect(hostsOutsideZone(["piloti.at", "app.dev.piloti.at"], "piloti.at")).toEqual([]);
  });

  it("rejects a zone that is only a string suffix, not a DNS parent", () => {
    expect(hostsOutsideZone(["notpiloti.at"], "piloti.at")).toEqual(["notpiloti.at"]);
  });

  it("rejects a host from a different zone entirely", () => {
    expect(hostsOutsideZone(["app.other.test", "app.piloti.at"], "piloti.at")).toEqual([
      "app.other.test",
    ]);
  });
});

describe("installDns", () => {
  beforeEach(() => {
    RESOURCES.length = 0;
  });

  it("returns undefined and creates nothing when disabled", async () => {
    const { result, records } = await install({
      ...dnsConfig(),
      "grid-oib:dnsEnabled": "false",
    });
    expect(result).toBeUndefined();
    expect(records).toEqual([]);
  });

  it("creates one unproxied A record per Gateway listener host, at the LoadBalancer IP", async () => {
    const { records } = await install(dnsConfig());
    expect(records.map((r) => r.inputs.name)).toEqual([
      `dev.${ZONE}`,
      `app.dev.${ZONE}`,
      `s3.dev.${ZONE}`,
    ]);
    for (const record of records) {
      expect(record.inputs.type).toBe("A");
      expect(record.inputs.content).toBe("203.0.113.10");
      expect(record.inputs.ttl).toBe(600);
      expect(record.inputs.proxied).toBe(false);
    }
  });

  it("publishes no otel host: the dashboard behind it is retired", async () => {
    const { records } = await install({
      ...dnsConfig(),
      "grid-oib:observabilityEnabled": "true",
      "grid-oib:otelPrimaryApiKey": "otel-key", // pragma: allowlist secret
      "grid-oib:otelDomain": `otel.dev.${ZONE}`,
      "grid-oib:otelOidcIssuer": "https://tenant.authkit.app",
      "grid-oib:otelOidcClientId": "client_test",
      "grid-oib:otelOidcClientSecret": "otel-secret", // pragma: allowlist secret
    });
    expect(records.map((r) => r.inputs.name)).not.toContain(`otel.dev.${ZONE}`);
  });

  it("leaves the zone-level records alone unless this stack claims the baseline", async () => {
    const { result, records } = await install(dnsConfig());
    expect(result?.baselineRecords).toEqual([]);
    expect(result?.apexRedirect).toBeUndefined();
    expect(records.map((r) => r.inputs.name)).not.toContain(`www.${ZONE}`);
  });

  it("publishes www and _dmarc when it does", async () => {
    const { records } = await install({
      ...dnsConfig(),
      "grid-oib:dnsZoneBaseline": "true",
      "grid-oib:dnsDmarc": "v=DMARC1; p=quarantine;",
    });
    const www = records.find((r) => r.inputs.name === `www.${ZONE}`);
    expect(www?.inputs.type).toBe("CNAME");
    expect(www?.inputs.content).toBe(ZONE);
    expect(www?.inputs.proxied).toBe(false);
    expect(www?.inputs.ttl).toBe(600);

    const dmarc = records.find((r) => r.inputs.name === `_dmarc.${ZONE}`);
    expect(dmarc?.inputs.type).toBe("TXT");
    expect(dmarc?.inputs.content).toBe("v=DMARC1; p=quarantine;");
  });

  it("parks the apex on an unroutable proxied placeholder plus a 302 ruleset", async () => {
    const { result, records } = await install({
      ...dnsConfig(),
      "grid-oib:dnsZoneBaseline": "true",
      "grid-oib:dnsApexRedirectTo": `https://dev.${ZONE}`,
    });

    const apex = records.find((r) => r.inputs.name === ZONE);
    expect(apex?.inputs.content).toBe(UNROUTABLE_PLACEHOLDER);
    expect(apex?.inputs.proxied).toBe(true);
    expect(apex?.inputs.ttl).toBe(TTL_AUTOMATIC);

    const www = records.find((r) => r.inputs.name === `www.${ZONE}`);
    expect(www?.inputs.proxied).toBe(true);
    expect(www?.inputs.ttl).toBe(TTL_AUTOMATIC);

    const ruleset = RESOURCES.find((r) => r.type.endsWith(":Ruleset"));
    expect(ruleset?.inputs.phase).toBe("http_request_dynamic_redirect");
    expect(ruleset?.inputs.kind).toBe("zone");
    const rule = (ruleset?.inputs.rules as RedirectRule[])[0];
    expect(rule.expression).toBe(`http.host in {"${ZONE}" "www.${ZONE}"}`);
    expect(rule.actionParameters.fromValue.targetUrl.value).toBe(`https://dev.${ZONE}`);
    expect(rule.actionParameters.fromValue.statusCode).toBe(302);

    expect(result?.apexRedirect).toBeDefined();
  });

  it("serves the apex for real and 301s www to it, when the baseline stack IS the apex", async () => {
    const { result, records } = await install({
      ...dnsConfig(),
      "grid-oib:baseDomain": ZONE,
      "grid-oib:dnsZoneBaseline": "true",
    });

    const apex = records.filter((r) => r.inputs.name === ZONE);
    expect(apex).toHaveLength(1);
    expect(apex[0].inputs.content).toBe("203.0.113.10");
    expect(apex[0].inputs.proxied).toBe(false);
    expect(result?.apexRedirect).toBeUndefined();

    const www = records.find((r) => r.inputs.name === `www.${ZONE}`);
    expect(www?.inputs.proxied).toBe(true);
    expect(www?.inputs.ttl).toBe(TTL_AUTOMATIC);

    const rulesets = RESOURCES.filter((r) => r.type.endsWith(":Ruleset"));
    expect(rulesets).toHaveLength(1);
    const rule = (rulesets[0].inputs.rules as WwwRedirectRule[])[0];
    expect(rule.expression).toBe(`http.host eq "www.${ZONE}"`);
    expect(rule.actionParameters.fromValue.targetUrl.expression).toBe(
      `concat("https://${ZONE}", http.request.uri.path)`,
    );
    expect(rule.actionParameters.fromValue.statusCode).toBe(301);
    expect(result?.wwwRedirect).toBeDefined();
  });
});

describe("installDns during a domain move (formerBaseDomain)", () => {
  const FORMER_ZONE_ID = "00000000000000000000000000f0f0f0";

  it("keeps the former apex and app host at the Gateway, in this zone when the move stays in it", async () => {
    const { result, records } = await install(dnsConfig({ [KEY("formerBaseDomain")]: `old.${ZONE}` }));
    const former = records.filter((r) => (r.inputs.name as string).endsWith(`old.${ZONE}`));
    expect(former.map((r) => r.inputs.name)).toEqual([`old.${ZONE}`, `app.old.${ZONE}`]);
    for (const record of former) {
      expect(record.inputs.zoneId).toBe("00000000000000000000000000abc123");
      expect(record.inputs.content).toBe("203.0.113.10");
      expect(record.inputs.proxied).toBe(false);
    }
    expect(result?.formerHostRecords).toHaveLength(2);
  });

  it("writes them to the former zone, under the names they had as this stack's own hosts", async () => {
    const { records } = await install(
      dnsConfig({
        [KEY("baseDomain")]: `dev.${ZONE}`,
        [KEY("formerBaseDomain")]: "dev.former.test",
        [KEY("formerDnsZoneName")]: "former.test",
        [KEY("formerDnsZoneId")]: FORMER_ZONE_ID,
      }),
    );
    const former = records.filter((r) => (r.inputs.name as string).endsWith("former.test"));
    expect(former.map((r) => r.name)).toEqual(["dns-dev.former.test", "dns-app.dev.former.test"]);
    for (const record of former) expect(record.inputs.zoneId).toBe(FORMER_ZONE_ID);
    const own = records.find((r) => r.inputs.name === `app.dev.${ZONE}`);
    expect(own?.inputs.zoneId).toBe("00000000000000000000000000abc123");
  });

  it("keeps the former zone's www, redirect and DMARC under their old names when the baseline stack moves", async () => {
    const { records } = await install(
      dnsConfig({
        [KEY("baseDomain")]: ZONE,
        [KEY("dnsZoneBaseline")]: "true",
        [KEY("formerBaseDomain")]: "former.test",
        [KEY("formerDnsZoneName")]: "former.test",
        [KEY("formerDnsZoneId")]: FORMER_ZONE_ID,
        [KEY("formerDnsDmarc")]: "v=DMARC1; p=quarantine",
      }),
    );
    const byName = new Map(records.map((r) => [r.name, r.inputs]));
    expect(byName.get("dns-www")).toMatchObject({ zoneId: FORMER_ZONE_ID, name: "www.former.test", content: "former.test", proxied: true })
    expect(byName.get("dns-dmarc")).toMatchObject({ zoneId: FORMER_ZONE_ID, name: "_dmarc.former.test", content: "v=DMARC1; p=quarantine" })
    expect(byName.get(`dns-www-${ZONE}`)).toMatchObject({ zoneId: "00000000000000000000000000abc123", name: `www.${ZONE}`, proxied: true })
    expect(byName.has(`dns-dmarc-${ZONE}`)).toBe(false)
    const rulesets = RESOURCES.filter((r) => r.type.endsWith(":Ruleset"));
    expect(rulesets.map((r) => [r.name, r.inputs.zoneId])).toEqual([
      [`dns-www-redirect-${ZONE}`, "00000000000000000000000000abc123"],
      ["dns-www-redirect", FORMER_ZONE_ID],
    ]);
  });

  it("refuses formerDnsDmarc outside a move of the baseline stack", async () => {
    const error = await loadWith(dnsConfig({ [KEY("formerDnsDmarc")]: "v=DMARC1; p=none" }));
    expect(error?.message).toContain(KEY("formerDnsDmarc"));
  });

  it("refuses former hosts outside every zone it names", async () => {
    const error = await loadWith(dnsConfig({ [KEY("formerBaseDomain")]: "dev.former.test" }));
    expect(error?.message).toContain("dev.former.test");
    expect(error?.message).toContain(KEY("formerDnsZoneId"));
  });

  it("refuses a former host this stack still serves", async () => {
    const error = await loadWith(dnsConfig({ [KEY("formerBaseDomain")]: `s3.dev.${ZONE}` }));
    expect(error?.message).toContain(`s3.dev.${ZONE}`);
    expect(error?.message).toContain("still serves");
  });

  it("refuses former hosts outside a complete former zone", async () => {
    const error = await loadWith(
      dnsConfig({
        [KEY("formerBaseDomain")]: "dev.other.test",
        [KEY("formerDnsZoneName")]: "former.test",
        [KEY("formerDnsZoneId")]: FORMER_ZONE_ID,
      }),
    );
    expect(error?.message).toContain("dev.other.test");
    expect(error?.message).toContain('outside the zone "former.test"');
  });

  it("refuses half of the former zone", async () => {
    const error = await loadWith(
      dnsConfig({
        [KEY("formerBaseDomain")]: "dev.former.test",
        [KEY("formerDnsZoneName")]: "former.test",
      }),
    );
    expect(error?.message).toContain("go together");
  });

  it("publishes nothing extra when no move is in progress", async () => {
    const { result } = await install(dnsConfig());
    expect(result?.formerHostRecords).toEqual([]);
  });
});

describe("loadConfig refuses DNS configurations that would deploy cleanly and be wrong", () => {
  it("refuses a zone id that is not one", async () => {
    const error = await loadWith(dnsConfig({ [KEY("dnsZoneId")]: "REPLACE_ME" }));
    expect(error?.message).toContain("not a Cloudflare zone id");
  });

  it("requires the whole Cloudflare triple, naming what is missing", async () => {
    const config = dnsConfig();
    delete config["grid-oib:dnsZoneId"];
    delete config["grid-oib:cloudflareApiToken"];
    const error = await loadWith(config);
    expect(error?.message).toContain("grid-oib:dnsZoneId");
    expect(error?.message).toContain("grid-oib:cloudflareApiToken");
  });

  it("requires a pinned LoadBalancer IP", async () => {
    const config = dnsConfig();
    delete config["grid-oib:loadBalancerIp"];
    const error = await loadWith(config);
    expect(error?.message).toContain("grid-oib:loadBalancerIp");
  });

  it("refuses hosts that fall outside the zone", async () => {
    const error = await loadWith({
      ...dnsConfig(),
      "grid-oib:baseDomain": "dev.elsewhere.test",
    });
    expect(error?.message).toContain("dev.elsewhere.test");
    expect(error?.message).toContain("RELATIVE");
  });

  it("refuses an apex redirect on a stack that already serves the apex", async () => {
    const error = await loadWith({
      ...dnsConfig(),
      "grid-oib:baseDomain": ZONE,
      "grid-oib:dnsZoneBaseline": "true",
      "grid-oib:dnsApexRedirectTo": "https://elsewhere.test",
    });
    expect(error?.message).toContain("already serves the apex");
  });

  it("refuses a stack that serves the apex without owning the zone baseline", async () => {
    const error = await loadWith({
      ...dnsConfig(),
      "grid-oib:baseDomain": ZONE,
    });
    expect(error?.message).toContain("grid-oib:dnsZoneBaseline must be true");
  });

  it("refuses an apex redirect from a stack that does not own the zone baseline", async () => {
    const error = await loadWith({
      ...dnsConfig(),
      "grid-oib:dnsApexRedirectTo": `https://dev.${ZONE}`,
    });
    expect(error?.message).toContain("grid-oib:dnsZoneBaseline");
  });

  it("refuses a redirect target that is not an absolute URL", async () => {
    const error = await loadWith({
      ...dnsConfig(),
      "grid-oib:dnsZoneBaseline": "true",
      "grid-oib:dnsApexRedirectTo": `dev.${ZONE}`,
    });
    expect(error?.message).toContain("absolute URL");
  });

  it("stays silent when DNS is off, whatever else is unset", async () => {
    const config = dnsConfig({ "grid-oib:dnsEnabled": "false" });
    delete config["grid-oib:dnsZoneId"];
    delete config["grid-oib:loadBalancerIp"];
    delete config["grid-oib:cloudflareApiToken"];
    expect(await loadWith(config)).toBeNull();
  });
});
