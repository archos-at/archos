import { describe, it, expect, beforeAll } from "vitest";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { loadConfig } from '../config'
import { baseStackConfig, langfuseStackConfig } from "../test-support/stack-config";
import { installClickHouse } from "./clickhouse";

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

function resolve(value: unknown): Promise<any> {
  return new Promise((done) =>
    (pulumi.output(value) as pulumi.Output<any>).apply((v: any) => {
      done(v);
      return v;
    }),
  );
}

function find(type: string, name: string) {
  const hit = RESOURCES.find((r) => r.type === type && r.name === name);
  if (!hit) {
    throw new Error(
      `no ${type} named "${name}". Built: ${RESOURCES.filter((r) => r.type === type).map((r) => r.name).join(", ") || "(none)"}`,
    );
  }
  return hit;
}

const SYSTEM_LOG_TABLES = [
  "asynchronous_insert_log",
  "asynchronous_metric_log",
  "background_schedule_pool_log",
  "error_log",
  "metric_log",
  "part_log",
  "processors_profile_log",
  "query_log",
  "query_metric_log",
  "text_log",
  "trace_log",
];

describe("ClickHouse system-log TTLs", () => {
  let ttlXml: string;
  let stsSpec: any;

  beforeAll(async () => {
    RESOURCES.length = 0;
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), ...langfuseStackConfig() });
    const provider = new k8s.Provider("test-provider", { kubeconfig: "apiVersion: v1" });
    installClickHouse(loadConfig(), provider, "grid", []);
    await new Promise((r) => setTimeout(r, 200));

    const cm = find("kubernetes:core/v1:ConfigMap", "clickhouse-config");
    ttlXml = ((await resolve(cm.inputs.data)) as Record<string, string>)["system-log-ttl.xml"];
    stsSpec = await resolve(find("kubernetes:apps/v1:StatefulSet", "clickhouse").inputs.spec);
  });

  it("bounds every system log table at fourteen days", () => {
    expect(ttlXml).toBeDefined();
    for (const table of SYSTEM_LOG_TABLES) {
      expect(ttlXml, `no TTL for ${table}`).toMatch(
        new RegExp(`<${table}>[\\s\\S]*?INTERVAL 14 DAY`),
      );
    }
  });

  it("leaves opentelemetry_span_log alone: its image section uses <engine>", () => {
    expect(ttlXml).not.toContain("opentelemetry_span_log");
  });

  it("mounts the drop-in by subPath so docker_related_config.xml survives", () => {
    const mounts = stsSpec.template.spec.containers[0].volumeMounts as Array<{
      name: string;
      mountPath: string;
      subPath?: string;
    }>;
    const ttlMount = mounts.find((m) => m.mountPath.endsWith("system-log-ttl.xml"));
    expect(ttlMount?.subPath).toBe("system-log-ttl.xml");
    expect(mounts.some((m) => m.mountPath === "/etc/clickhouse-server/config.d")).toBe(false);
    const volumes = stsSpec.template.spec.volumes as Array<{
      name: string;
      configMap: { name: string };
    }>;
    expect(volumes.find((v) => v.name === "config-d")?.configMap.name).toBe("clickhouse-config");
  });

  it("rolls the pod when the TTL file changes", async () => {
    const annotations = stsSpec.template.metadata.annotations as Record<string, unknown>;
    const checksum = await resolve(annotations["grid.bigls.net/secret-checksum"]);
    expect(checksum).toMatch(/^[0-9a-f]{16}$/);
  });

  it("provisions fifty gibibytes for both stacks by default", () => {
    const claims = stsSpec.volumeClaimTemplates as Array<any>;
    expect(claims[0].spec.resources.requests.storage).toBe("50Gi");
  });
});
