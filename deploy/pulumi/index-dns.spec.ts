import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig, langfuseStackConfig } from "./src/test-support/stack-config";

const RESOURCES: Array<{ type: string; name: string; inputs: Record<string, unknown> }> = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      return {
        id: `${args.name}-id`,
        state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } },
      };
    },
    call: () => ({}),
  },
  "grid-oib",
  "test",
  false,
);

const ZONE = "example.test";

const KEY = (name: string) => `${pulumi.getProject()}:${name}`;

type GatewaySpec = { listeners: Array<{ name: string; protocol: string; hostname?: string }> };

describe("the program constructs with public DNS enabled", () => {
  beforeAll(async () => {
    pulumi.runtime.setAllConfig({
      ...baseStackConfig(),
      ...langfuseStackConfig(),
      "grid-oib:baseDomain": `dev.${ZONE}`,
      "grid-oib:seaweedfsTopology": "single",
      "grid-oib:seaweedfsPerOrgBuckets": "false",
      "grid-oib:otelOidcIssuer": "https://tenant.authkit.app",
      "grid-oib:otelOidcClientId": "client_test",
      "grid-oib:otelOidcClientSecret": "otel-secret", // pragma: allowlist secret
      "grid-oib:loadBalancerIp": "203.0.113.10",
      "grid-oib:dnsEnabled": "true",
      "grid-oib:dnsZoneId": "00000000000000000000000000abc123",
      "grid-oib:dnsZoneName": ZONE,
      "grid-oib:cloudflareApiToken": "cf-token", // pragma: allowlist secret
      [KEY("formerBaseDomain")]: "dev.former.test",
      [KEY("formerDnsZoneName")]: "former.test",
      [KEY("formerDnsZoneId")]: "00000000000000000000000000f0f0f0",
    });
    const stack = (await import("./index")) as Record<string, unknown>;
    await Promise.all(
      Object.values(stack)
        .filter((v): v is pulumi.Output<unknown> => pulumi.Output.isInstance(v))
        .map((output) => new Promise((resolve) => output.apply(resolve))),
    );
  }, 120_000);

  function listenerHosts(): string[] {
    const gateway = RESOURCES.find((r) => r.name === "grid-gateway");
    const spec = gateway?.inputs.spec as GatewaySpec | undefined;
    return (spec?.listeners ?? [])
      .filter((l) => l.protocol === "HTTPS" && l.hostname !== undefined)
      .map((l) => l.hostname as string);
  }

  function dnsHosts(): string[] {
    return RESOURCES.filter((r) => r.type === "cloudflare:index/dnsRecord:DnsRecord").map(
      (r) => r.inputs.name as string,
    );
  }

  it("publishes an A record for every HTTPS listener, and nothing else", () => {
    expect([...dnsHosts()].sort()).toEqual([...listenerHosts()].sort());
  });

  it("covers the conditional listeners too", () => {
    for (const host of [`langfuse.dev.${ZONE}`, `qdrant.dev.${ZONE}`]) {
      expect(listenerHosts()).toContain(host);
      expect(dnsHosts()).toContain(host);
    }
    for (const host of ["dev.former.test", "app.dev.former.test"]) {
      expect(listenerHosts()).toContain(host);
      expect(dnsHosts()).toContain(host);
    }
    expect(dnsHosts()).toHaveLength(7);
  });

  it("points every record at the pinned LoadBalancer IP", () => {
    const records = RESOURCES.filter((r) => r.type === "cloudflare:index/dnsRecord:DnsRecord");
    for (const record of records) {
      expect(record.inputs.content).toBe("203.0.113.10");
    }
  });
});
