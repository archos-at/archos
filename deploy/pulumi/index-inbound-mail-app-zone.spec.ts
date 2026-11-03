import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "./src/test-support/stack-config";
import { APP_ZONE, APP_ZONE_ID, appZoneStackConfig, mailStackConfig } from "./src/test-support/app-zone-config";
import { LEGACY_PROJECT } from "./src/names";

/**
 * The whole program as production runs it: project mail on a subdomain of the
 * product's own zone (`inbox.<zone>`), the zone this stack already manages for
 * DNS, and switched off (`inboundMailEnabled: false`), the state a stack
 * passes through on the way to removing the feature.
 *
 * A separate file for the reason `index-dns.spec.ts` gives: `index.ts` works at
 * module scope and Pulumi's runtime is process-global.
 *
 * What only the whole program shows: with no `inboundMailZoneId`, routing and
 * the rule land on the app zone, beside the DNS module's records, with routing
 * on the subdomain and never the apex; and switched off, the rule stays
 * (disabled) while the Worker and the frontend's domain go.
 */

type Recorded = { type: string; name: string; inputs: Record<string, unknown> };
const RESOURCES: Recorded[] = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      return {
        id: `${args.name}-id`,
        state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } },
      };
    },
    call: (args: pulumi.runtime.MockCallArgs) => {
      if (args.token === "cloudflare:index/getZone:getZone") {
        const zoneId = String(args.inputs.zoneId);
        const name = zoneId === APP_ZONE_ID ? APP_ZONE : undefined;
        return { id: zoneId, name, account: { id: "account-1", name: "Office" } };
      }
      if (args.token === "cloudflare:index/getDnsRecords:getDnsRecords") {
        return { results: [] };
      }
      return {};
    },
  },
  LEGACY_PROJECT,
  "test",
  false,
);

type EnvVar = { name: string };

const byType = (type: string) => RESOURCES.filter((r) => r.type === type);

function containerEnv(deploymentName: string): EnvVar[] {
  const deployment = RESOURCES.find(
    (r) =>
      r.type === "kubernetes:apps/v1:Deployment" &&
      (r.inputs.metadata as { name?: string } | undefined)?.name === deploymentName,
  );
  const spec = deployment?.inputs.spec as {
    template: { spec: { containers: Array<{ env: EnvVar[] }> } };
  };
  return spec.template.spec.containers[0].env;
}

const INBOX = `inbox.${APP_ZONE}`;

describe("the program with project mail on a subdomain of the app zone, switched off", () => {
  beforeAll(async () => {
    pulumi.runtime.setAllConfig({
      ...baseStackConfig(),
      ...appZoneStackConfig(),
      ...mailStackConfig(),
      [`${LEGACY_PROJECT}:seaweedfsTopology`]: "single",
      [`${LEGACY_PROJECT}:seaweedfsPerOrgBuckets`]: "false",
      [`${LEGACY_PROJECT}:observabilityEnabled`]: "false",
      // No inboundMailZoneId: under the app zone it defaults to dnsZoneId.
      [`${LEGACY_PROJECT}:inboundMailDomain`]: INBOX,
      [`${LEGACY_PROJECT}:inboundMailEnabled`]: "false",
    });
    const stack = (await import("./index")) as Record<string, unknown>;
    await Promise.all(
      Object.values(stack)
        .filter((v): v is pulumi.Output<unknown> => pulumi.Output.isInstance(v))
        .map((output) => new Promise((resolve) => output.apply(resolve))),
    );
  }, 120_000);

  it("keeps routing on once, on the subdomain, never on the app zone's apex", () => {
    const routing = byType("cloudflare:index/emailRoutingDns:EmailRoutingDns");
    expect(routing.map((r) => [r.inputs.zoneId, r.inputs.name])).toEqual([[APP_ZONE_ID, INBOX]]);
    expect(byType("cloudflare:index/emailRoutingSettings:EmailRoutingSettings")).toEqual([]);
  });

  it("keeps the rule on the app zone, disabled, and deploys no Worker", () => {
    const rules = byType("cloudflare:index/emailRoutingRule:EmailRoutingRule");
    expect(rules.map((r) => [r.inputs.zoneId, r.inputs.enabled])).toEqual([[APP_ZONE_ID, false]]);
    expect(byType("cloudflare:index/emailRoutingCatchAll:EmailRoutingCatchAll")).toEqual([]);
    expect(byType("cloudflare:index/workersScript:WorkersScript")).toEqual([]);
  });

  it("takes the domain off the frontend, which hides the address in the UI, and keeps the empty key map", () => {
    const names = containerEnv("frontend").map((e) => e.name);
    expect(names).not.toContain("INBOUND_MAIL_DOMAIN");
    expect(names).not.toContain("INBOUND_MAIL_LOCAL_PART");
    expect(names).not.toContain("INBOUND_MAIL_PAUSED");
    expect(names).toContain("INBOUND_MAIL_SIGNING_KEYS");
  });
});
