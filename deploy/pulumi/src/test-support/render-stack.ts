import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import * as pulumi from "@pulumi/pulumi";
import { SIGNING_KEYS } from "./app-zone-config";
import { baseStackConfig, langfuseStackConfig } from "./stack-config";

export type Rendered = { type: string; name: string; inputs: Record<string, unknown> };

const ROOT = join(__dirname, "..", "..");

export function stackFileConfig(stack: "dev" | "prod"): Record<string, string> {
  const doc = load(readFileSync(join(ROOT, `Pulumi.${stack}.yaml`), "utf8")) as { config: Record<string, unknown> };
  return Object.fromEntries(
    Object.entries(doc.config)
      .filter(([, v]) => v !== null && typeof v !== "object")
      .map(([k, v]) => [k, String(v)]),
  );
}

const ESC_SECRETS: Record<string, string> = {
  "grid-oib:cloudflareApiToken": "cf-token", // pragma: allowlist secret
  "grid-oib:err2issueGithubToken": "ghp-test", // pragma: allowlist secret
  "grid-oib:otelPrimaryApiKey": "otel-key", // pragma: allowlist secret
  "grid-oib:inboundMailSigningKeys": SIGNING_KEYS,
  "grid-oib:jobPayloadKek": "a2VrLWtlay1rZWsta2VrLWtlay1rZWsta2VrLWtlay0=", // pragma: allowlist secret
};

export function stackConfig(stack: "dev" | "prod"): Record<string, string> {
  const file = stackFileConfig(stack);
  const registry: Record<string, string> = file["grid-oib:registryUsername"] ? { "grid-oib:registryPassword": "registry" } : {}; // pragma: allowlist secret
  return { ...baseStackConfig(), ...langfuseStackConfig(), ...ESC_SECRETS, ...registry, ...file };
}

function zoneNames(): Record<string, string> {
  const names: Record<string, string> = {};
  for (const stack of ["dev", "prod"] as const) {
    const file = stackFileConfig(stack);
    for (const prefix of ["dns", "formerDns"]) {
      const id = file[`grid-oib:${prefix}ZoneId`];
      if (id) names[id] = file[`grid-oib:${prefix}ZoneName`];
    }
    const mailId = file["grid-oib:inboundMailZoneId"];
    if (mailId && !names[mailId]) names[mailId] = file["grid-oib:inboundMailDomain"].split(".").slice(-2).join(".");
  }
  return names;
}

export function captureResources(): Rendered[] {
  const resources: Rendered[] = [];
  const zones = zoneNames();
  const operators = (["dev", "prod"] as const)
    .map((stack) => stackFileConfig(stack)["grid-oib:inboundMailOperatorAddress"])
    .filter((email): email is string => Boolean(email));
  pulumi.runtime.setMocks(
    {
      newResource: (args: pulumi.runtime.MockResourceArgs) => {
        resources.push({ type: args.type, name: args.name, inputs: args.inputs });
        return { id: `${args.name}-id`, state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } } };
      },
      call: (args: pulumi.runtime.MockCallArgs) => {
        if (args.token === "cloudflare:index/getZone:getZone") {
          return { id: args.inputs.zoneId, name: zones[args.inputs.zoneId as string], account: { id: "account-1", name: "Office" } };
        }
        if (args.token === "cloudflare:index/getDnsRecords:getDnsRecords") {
          return { results: [{ name: args.inputs.name?.exact ?? "", content: "route1.mx.cloudflare.net", type: "MX" }] };
        }
        if (args.token === "cloudflare:index/getEmailRoutingAddresses:getEmailRoutingAddresses") {
          return { results: operators.map((email) => ({ email, verified: "2026-11-05T00:00:00Z" })) };
        }
        return {};
      },
    },
    "grid-oib",
    "test",
    false,
  );
  return resources;
}

export async function renderProgram(load: () => Promise<Record<string, unknown>>): Promise<void> {
  const stack = await load();
  await Promise.all(
    Object.values(stack)
      .filter((v): v is pulumi.Output<unknown> => pulumi.Output.isInstance(v))
      .map((output) => new Promise((resolve) => output.apply(resolve))),
  );
}

export type ResourceBlock = { requests?: Record<string, unknown>; limits?: Record<string, unknown> };

export function resourceBlocks(resources: Rendered[]): Record<string, ResourceBlock> {
  const found: Record<string, ResourceBlock> = {};
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${path}[${(v as { name?: string })?.name ?? i}]`));
    if (value === null || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    if (obj.requests && typeof obj.requests === "object" && "cpu" in (obj.requests as object)) {
      found[path] = obj as ResourceBlock;
    }
    for (const [key, child] of Object.entries(obj)) walk(child, `${path}.${key}`);
  };
  for (const r of resources) walk(r.inputs, `${r.type.split(":").slice(1).join(":")}/${r.name}`);
  return found;
}

export function cpuScalingTargets(resources: Rendered[]): Record<string, unknown> {
  const found: Record<string, unknown> = {};
  for (const r of resources) {
    const spec = (r.inputs.spec ?? {}) as Record<string, any>;
    const id = `${r.type.split(":").slice(1).join(":")}/${r.name}`;
    for (const m of spec.metrics ?? []) {
      if (m?.resource?.name === "cpu") found[`${id}.metrics[cpu]`] = m.resource.target;
    }
    for (const t of spec.triggers ?? []) {
      if (t?.type === "cpu") found[`${id}.triggers[cpu]`] = t.metadata;
    }
  }
  return found;
}

export function cpuRequestRender(resources: Rendered[]): { resources: Record<string, ResourceBlock>; cpuScalingTargets: Record<string, unknown> } {
  return { resources: resourceBlocks(resources), cpuScalingTargets: cpuScalingTargets(resources) };
}

export type PodRequest = { pod: string; kind: "steady" | "daemon" | "transient"; replicas: number; millicores: number; group?: string };

const REPLICA_KEYS = ["replicas", "replicaCount", "instances"];
const TRANSIENT = /^batch\/v1:(Job|CronJob)\//;
const DAEMON = /^apps\/v1:DaemonSet\//;

export function podRequests(resources: Rendered[]): PodRequest[] {
  const minReplicas: Record<string, number> = {};
  for (const r of resources) {
    const spec = (r.inputs.spec ?? {}) as Record<string, any>;
    const target = spec.scaleTargetRef?.name;
    const min = spec.minReplicas ?? spec.minReplicaCount;
    if (typeof target === "string" && typeof min === "number") minReplicas[target] = min;
  }
  const pods = new Map<string, PodRequest & { containers: number; init: number }>();
  const walk = (value: unknown, path: string, replicas: number | undefined, group: string | undefined, init: boolean): void => {
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${path}[${(v as { name?: string })?.name ?? i}]`, replicas, group, init));
    if (value === null || typeof value !== "object") return;
    const obj = value as Record<string, any>;
    for (const key of REPLICA_KEYS) if (typeof obj[key] === "number") replicas = obj[key];
    const selected = obj.nodeSelector?.["k8s.at/node-group"];
    if (typeof selected === "string") group = selected;
    if (obj.requests && typeof obj.requests === "object" && typeof obj.requests.cpu === "string") {
      const pod = path.replace(/\.(initContainers|containers)\[[^\]]*\]\.resources$/, "").replace(/\.resources$/, "");
      const entry = pods.get(pod) ?? { pod, kind: "steady", replicas: 1, millicores: 0, containers: 0, init: 0, group };
      const m = cpuMillicoresOf(obj.requests.cpu);
      if (init) entry.init = Math.max(entry.init, m);
      else entry.containers += m;
      entry.replicas = replicas ?? entry.replicas;
      entry.group = group ?? entry.group;
      pods.set(pod, entry);
    }
    for (const [key, child] of Object.entries(obj)) walk(child, `${path}.${key}`, replicas, group, init || key === "initContainers");
  };
  for (const r of resources) {
    const id = `${r.type.split(":").slice(1).join(":")}/${r.name}`;
    const name = (r.inputs.metadata as { name?: string } | undefined)?.name ?? r.name;
    walk(r.inputs, id, minReplicas[name], undefined, false);
  }
  return [...pods.values()].map(({ containers, init, ...p }) => ({
    ...p,
    kind: TRANSIENT.test(p.pod) ? "transient" : DAEMON.test(p.pod) ? "daemon" : "steady",
    millicores: Math.max(containers, init),
  }));
}

function cpuMillicoresOf(quantity: string): number {
  return quantity.endsWith("m") ? Number(quantity.slice(0, -1)) : Number(quantity) * 1000;
}

export const pathKey = (path: string): string => createHash("sha256").update(path).digest("hex").slice(0, 16);

export function keyedByPathHash<T>(entries: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(entries).map(([path, value]) => [pathKey(path), value]));
}
