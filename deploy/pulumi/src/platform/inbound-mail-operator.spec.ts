import { beforeEach, describe, expect, it, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import type { DeployConfig } from "../config";
import type { MailZone } from "./email-routing";
import { installOperatorForwards } from "./inbound-mail-operator";

interface Created {
  name: string;
  args: Record<string, unknown>;
  opts: Record<string, unknown>;
}

const created = vi.hoisted(() => ({
  addresses: [] as Created[],
  rules: [] as Created[],
  destinations: [] as Array<{ email: string; verified: string | null }>,
}));

vi.mock("@pulumi/cloudflare", async () => {
  const { output } = await import("@pulumi/pulumi");

  class EmailRoutingAddress {
    readonly email: pulumi.Output<string>;
    readonly verified: pulumi.Output<string>;

    constructor(name: string, args: Record<string, unknown>, opts: Record<string, unknown>) {
      created.addresses.push({ name, args, opts });
      this.email = output(String(args.email));
      this.verified = output("2026-11-05T10:00:00Z");
    }
  }

  class EmailRoutingRule {
    constructor(name: string, args: Record<string, unknown>, opts: Record<string, unknown>) {
      created.rules.push({ name, args, opts });
    }
  }

  return {
    EmailRoutingAddress,
    EmailRoutingRule,
    getEmailRoutingAddressesOutput: () => output({ results: created.destinations }),
  };
});

const DOMAIN = "inbox.example.test";
const OPERATOR = "mail-ops@company.example";

function zoneWithRouting(): MailZone {
  return {
    provider: {} as MailZone["provider"],
    domain: DOMAIN,
    zoneId: pulumi.output("zone-1"),
    accountId: pulumi.output("account-1"),
    zoneName: pulumi.output("example.test"),
    routing: {} as MailZone["routing"],
  };
}

function config(shared: boolean): DeployConfig {
  return { inboundMail: { domain: DOMAIN, operatorAddress: OPERATOR, operatorAddressShared: shared } } as DeployConfig;
}

beforeEach(() => {
  created.addresses.length = 0;
  created.rules.length = 0;
  created.destinations.length = 0;
});

describe("the RFC 2142 forwards to an operator address this stack owns", () => {
  it("keeps the address when the stack is destroyed", () => {
    const zone = zoneWithRouting();
    installOperatorForwards(config(false), zone);
    expect(created.addresses).toHaveLength(1);
    expect(created.addresses[0].opts).toMatchObject({ retainOnDelete: true });
    expect(created.addresses[0].opts.provider).toBe(zone.provider);
  });

  it("orders each forward after the routing and the address", () => {
    const zone = zoneWithRouting();
    const forwards = installOperatorForwards(config(false), zone);
    expect(created.rules).toHaveLength(2);
    for (const rule of created.rules) {
      const dependsOn = rule.opts.dependsOn as unknown[];
      expect(dependsOn).toHaveLength(2);
      expect(dependsOn[0]).toBe(zone.routing);
      expect(dependsOn[1]).toBe(forwards.address);
    }
  });
});

describe("the RFC 2142 forwards to a shared operator address", () => {
  it("creates no address and orders each forward after the routing alone", () => {
    created.destinations.push({ email: OPERATOR, verified: "2026-11-05T10:00:00Z" });
    const zone = zoneWithRouting();
    const forwards = installOperatorForwards(config(true), zone);
    expect(forwards.address).toBeUndefined();
    expect(created.addresses).toEqual([]);
    expect(created.rules).toHaveLength(2);
    for (const rule of created.rules) {
      const dependsOn = rule.opts.dependsOn as unknown[];
      expect(dependsOn).toHaveLength(1);
      expect(dependsOn[0]).toBe(zone.routing);
    }
  });
});
