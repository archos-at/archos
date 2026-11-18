import * as pulumi from "@pulumi/pulumi";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { LEGACY_PROJECT } from "../names";
import { SIGNING_KEYS } from "./app-zone-config";
import { baseStackConfig } from "./stack-config";

export type PlannedResource = { type: string; name: string; inputs: Record<string, any> };

const ZONE_NAMES: Record<string, string> = {
  "66de14f8d07a729634f5d230418bb907": "piloti.at", // pragma: allowlist secret (public zone id)
  "31df51fbdd7ea2d7ef63bcaab9a09559": "archos.tech", // pragma: allowlist secret (public zone id)
};

const PROGRAM_ROOT = join(__dirname, "..", "..");

export function devStackConfig(): Record<string, string> {
  const file = load(readFileSync(join(PROGRAM_ROOT, "Pulumi.dev.yaml"), "utf8")) as { config: Record<string, unknown> };
  return { ...baseStackConfig(), ...Object.fromEntries(
    Object.entries(file.config).map(([key, value]) => [
      key,
      value && typeof value === "object" && "secure" in value
        ? "placeholder-secret-value"
        : typeof value === "string"
          ? value
          : JSON.stringify(value),
    ]),
  ),
    [`${LEGACY_PROJECT}:registryPassword`]: "placeholder-secret-value",
    [`${LEGACY_PROJECT}:otelOidcClientSecret`]: "placeholder-secret-value",
    [`${LEGACY_PROJECT}:cloudflareApiToken`]: "placeholder-secret-value",
    [`${LEGACY_PROJECT}:inboundMailSigningKeys`]: SIGNING_KEYS,
  };
}

export function mockDevStack(): PlannedResource[] {
  const resources: PlannedResource[] = [];
  pulumi.runtime.setMocks(
    {
      newResource: (args: pulumi.runtime.MockResourceArgs) => {
        resources.push({ type: args.type, name: args.name, inputs: args.inputs });
        return { id: `${args.name}-id`, state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } } };
      },
      call: (args: pulumi.runtime.MockCallArgs) => {
        if (args.token === "cloudflare:index/getZone:getZone") {
          return { id: args.inputs.zoneId, name: ZONE_NAMES[args.inputs.zoneId as string], account: { id: "account-1", name: "Office" } };
        }
        if (args.token === "cloudflare:index/getDnsRecords:getDnsRecords") {
          return { results: [{ name: args.inputs.name?.exact ?? "", content: "route1.mx.cloudflare.net", type: "MX" }] };
        }
        return {};
      },
    },
    LEGACY_PROJECT,
    "dev",
    false,
  );
  return resources;
}

export async function planDevStack(): Promise<void> {
  pulumi.runtime.setAllConfig(devStackConfig());
  await import("../../index");
  await new Promise((r) => setTimeout(r, 200));
}
