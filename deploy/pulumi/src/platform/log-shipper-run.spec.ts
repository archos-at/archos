import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dump } from "js-yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOG_SHIPPER } from "../config/observability";
import { BACKFILL_POD } from "../constants";
import { podLogs } from "./log-shipper";
import { containerLogs, kubernetesEvents, posthogLogs, SHIPPER_RECEIVER, WITHHELD } from "./otel-collector";

const OTELCOL_BIN = process.env.OTELCOL_BIN;

type Row = {
  resource: Record<string, unknown>;
  attributes: Record<string, unknown>;
  body: unknown;
  severity?: number;
  severityText?: string;
};

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

function flat(attributes: Array<{ key: string; value: Record<string, unknown> }> = []): Record<string, unknown> {
  return Object.fromEntries(attributes.map(({ key, value }) => [key, Object.values(value)[0]]));
}

function rows(file: string): Row[] {
  if (!existsSync(file)) return [];
  const complete = readFileSync(file, "utf8").split("\n").slice(0, -1);
  return complete
    .filter(Boolean)
    .flatMap((line) => JSON.parse(line).resourceLogs ?? [])
    .flatMap((rl: any) =>
      (rl.scopeLogs ?? []).flatMap((sl: any) =>
        (sl.logRecords ?? []).map((r: any) => ({
          resource: flat(rl.resource?.attributes),
          attributes: flat(r.attributes),
          body: r.body ? Object.values(r.body)[0] : undefined,
          severity: r.severityNumber,
          severityText: r.severityText,
        })),
      ),
    );
}

async function waitFor(file: string, done: (rows: Row[]) => boolean): Promise<Row[]> {
  for (let i = 0; i < 200; i += 1) {
    const got = rows(file);
    if (done(got)) return got;
    await new Promise((r) => setTimeout(r, 100));
  }
  return rows(file);
}

async function start(config: object, dir: string, probe?: number): Promise<ChildProcess> {
  const file = join(dir, "collector.yaml");
  writeFileSync(file, dump(config));
  let stderr = "";
  const collector = spawn(OTELCOL_BIN!, [`--config=${file}`], { stdio: ["ignore", "ignore", "pipe"] });
  collector.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise((r) => collector.once("exit", r));
  await new Promise<void>((resolve, reject) => {
    collector.once("spawn", resolve);
    collector.once("error", reject);
  });
  if (probe === undefined) return collector;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && collector.exitCode === null) {
    const up = await fetch(`http://127.0.0.1:${probe}/v1/logs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(1000),
    })
      .then(() => true)
      .catch(() => false);
    if (up) return collector;
    await new Promise((r) => setTimeout(r, 100));
  }
  collector.kill();
  await exited;
  throw new Error(`the collector did not start:\n${stderr.slice(-2000)}`);
}

const cri = (stream: "stdout" | "stderr", line: string) => `2026-11-17T10:00:00.000000000Z ${stream} F ${line}`;

function podLog(root: string, namespace: string, pod: string, container: string, lines: string[]): void {
  const dir = join(root, `${namespace}_${pod}_0f6e2c1a-9b3d-4c2e-8a1f-5d7e9c0b2a41`, container);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "0.log"), lines.join("\n") + "\n");
}

describe.skipIf(!OTELCOL_BIN)("the log shipper, run on CRI files", () => {
  let collector: ChildProcess;
  let out: string;
  let shipped: Row[];

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "log-shipper-"));
    const root = join(dir, "pods");
    out = join(dir, "shipped.jsonl");
    podLog(root, "cms", "cms-7d9f-abcde", "cms", [
      cri("stdout", '{"level":30,"msg":"server starting"}'),
      cri("stdout", '{"level":20,"msg":"resolved config"}'),
      cri("stderr", "Error: connect ECONNREFUSED 10.0.0.7:5432"),
      cri("stdout", "WARN slow query"),
      cri("stderr", "    at load (node:internal/trace/events:10:2)"),
      cri("stdout", "2026-11-17 10:00:00 DEBUG pool size 4"),
      `2026-11-17T10:00:00.000000000Z stderr P ${"x".repeat(12 * 1024)}`,
      `2026-11-17T10:00:00.000000000Z stderr F ${"y".repeat(12 * 1024)}`,
    ]);
    podLog(root, "app", "web-6b-qwert", "web", [
      ...Array.from({ length: 400 }, (_, i) => cri("stdout", `GET /page/${i} 200`)),
      ...Array.from({ length: 50 }, (_, i) => cri("stdout", `WARN cache miss ${i}`)),
    ]);
    podLog(root, "app", `${BACKFILL_POD}-after-f11c384a-4q5jw`, "lanes", [
      ...Array.from({ length: 40 }, (_, i) =>
        cri("stdout", `{"event":"backfill.count","backfill":"lanes","store":"s${i}","before":0,"written":0,"after":0}`),
      ),
    ]);
    podLog(root, "app", "api-5c-xyz", "api", [cri("stderr", "Traceback: office text from the API")]);
    podLog(root, "app", "otel-collector-1-xyz", "collector", [cri("stderr", "ERROR exporting failed")]);
    podLog(root, "app", "main-pg-1", "postgres", [cri("stderr", "ERROR duplicate key value")]);
    podLog(root, "kube-system", "coredns-1", "coredns", [cri("stderr", "ERROR from kube-system")]);

    const fragment = podLogs(["app", "cms"]);
    const receiver = JSON.parse(JSON.stringify(fragment.receivers!["filelog/pods"]).split(LOG_SHIPPER.podLogDir).join(root));
    const { k8sattributes: _needsTheApi, ...processors } = fragment.processors!;
    const pipeline = fragment.pipelines!["logs/pods"];
    collector = await start(
      {
        receivers: { "filelog/pods": { ...receiver, start_at: "beginning" } },
        processors,
        exporters: { file: { path: out, flush_interval: "100ms" } },
        service: {
          telemetry: { metrics: { level: "none" } },
          pipelines: {
            logs: {
              receivers: pipeline.receivers,
              processors: pipeline.processors!.filter((p) => p !== "k8sattributes"),
              exporters: ["file"],
            },
          },
        },
      },
      dir,
    );
    shipped = await waitFor(
      out,
      (got) =>
        got.some((r) => String(r.body).includes("slow query")) &&
        got.some((r) => String(r.body).includes("cache miss 49")) &&
        got.filter((r) => String(r.body).includes('"backfill":"lanes"')).length === 40,
    );
  }, 20_000);

  afterAll(() => {
    collector?.kill();
  });

  it("names the pod, the container and the service from the file path, and marks the row as a container log", () => {
    const crash = shipped.find((r) => String(r.body).includes("ECONNREFUSED"));
    expect(crash?.resource).toMatchObject({
      "k8s.namespace.name": "cms",
      "k8s.pod.name": "cms-7d9f-abcde",
      "k8s.container.name": "cms",
      "service.name": "cms",
      "collector.log.source": "container",
    });
    expect(crash?.attributes).not.toHaveProperty("log.file.path");
  });

  it("reads a severity from the line, in the lowercase text PostHog's severity filter matches", () => {
    expect(shipped.find((r) => String(r.body).includes("ECONNREFUSED"))).toMatchObject({ severity: 17, severityText: "error" });
    expect(shipped.find((r) => String(r.body).includes("slow query"))?.severity).toBe(13);
  });

  it("reads a level only where a line states one: a stack frame naming a trace path stays a warning", () => {
    expect(shipped.find((r) => String(r.body).includes("internal/trace/events"))).toMatchObject({ severity: 13, severityText: "warn" });
  });

  it("cuts a line recombined from CRI fragments at the size limit", () => {
    const long = shipped.filter((r) => String(r.body).startsWith("xxxx"));
    expect(long).not.toHaveLength(0);
    for (const row of long) expect(String(row.body).length).toBeLessThanOrEqual(LOG_SHIPPER.maxLineBytes);
  });

  it("drops debug and leaves no sampling bookkeeping on the rows", () => {
    expect(shipped.some((r) => String(r.body).includes("resolved config"))).toBe(false);
    expect(shipped.some((r) => String(r.body).includes("pool size"))).toBe(false);
    for (const row of shipped) {
      expect(row.attributes).not.toHaveProperty("sampling.key");
      expect(row.attributes).not.toHaveProperty("sampling.priority");
    }
  });

  it("keeps every warning and samples info lines at the configured rate", () => {
    const web = shipped.filter((r) => r.resource["service.name"] === "web");
    expect(web.filter((r) => String(r.body).startsWith("WARN cache miss"))).toHaveLength(50);
    const info = web.filter((r) => String(r.body).startsWith("GET /page/")).length;
    expect(LOG_SHIPPER.infoSamplePercent).toBe(10);
    expect(info).toBeGreaterThan(10);
    expect(info).toBeLessThan(100);
  });

  it("keeps every info line of a backfill pod, which carries the deploy's counts", () => {
    const backfill = shipped.filter((r) => String(r.resource["k8s.pod.name"]).startsWith(`${BACKFILL_POD}-`));
    expect(backfill).toHaveLength(40);
    expect(backfill.every((r) => r.severityText === "info")).toBe(true);
    expect(backfill.every((r) => !("sampling.priority" in r.attributes))).toBe(true);
  });

  it("reads nothing from an instrumented service, the collector, a noisy store or another namespace", () => {
    const bodies = shipped.map((r) => String(r.body)).join("\n");
    expect(bodies).not.toContain("office text");
    expect(bodies).not.toContain("exporting failed");
    expect(bodies).not.toContain("duplicate key");
    expect(bodies).not.toContain("kube-system");
  });
});

describe.skipIf(!OTELCOL_BIN)("the gateway, on what the shipper and the SDKs send", () => {
  let collector: ChildProcess;
  const port = { sdk: 0, shipper: 0, events: 0 };
  let out: string;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "gateway-logs-"));
    out = join(dir, "exported.jsonl");
    port.sdk = await freePort();
    port.shipper = await freePort();
    port.events = await freePort();
    const sdk = posthogLogs("https://eu.i.posthog.com", "phc_test", "dev");
    const containers = containerLogs();
    const events = kubernetesEvents(["app"]);
    const otlpOn = (p: number) => ({ protocols: { http: { endpoint: `127.0.0.1:${p}` } } });
    const asFile = (p: { processors?: string[] }, receiver: string) => ({
      receivers: [receiver],
      processors: p.processors ?? [],
      exporters: ["file"],
    });
    collector = await start(
      {
        receivers: { otlp: otlpOn(port.sdk), [SHIPPER_RECEIVER]: otlpOn(port.shipper), "otlp/events": otlpOn(port.events) },
        processors: { ...sdk.processors, ...containers.processors, ...events.processors },
        exporters: { file: { path: out, flush_interval: "100ms" } },
        service: {
          telemetry: { metrics: { level: "none" } },
          pipelines: {
            "logs/posthog": asFile(sdk.pipelines!["logs/posthog"], "otlp"),
            "logs/containers": asFile(containers.pipelines!["logs/containers"], SHIPPER_RECEIVER),
            "logs/k8s_events": asFile(events.pipelines!["logs/k8s_events"], "otlp/events"),
          },
        },
      },
      dir,
      port.sdk,
    );
  }, 20_000);

  afterAll(() => {
    collector?.kill();
  });

  const send = async (to: keyof typeof port, resource: Record<string, string>, body: unknown, severityNumber = 17) => {
    const response = await fetch(`http://127.0.0.1:${port[to]}/v1/logs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resourceLogs: [
          {
            resource: { attributes: Object.entries(resource).map(([key, v]) => ({ key, value: { stringValue: v } })) },
            scopeLogs: [{ logRecords: [{ severityNumber, body }] }],
          },
        ],
      }),
    });
    expect(response.status).toBe(200);
  };

  const kv = (o: Record<string, unknown>): unknown => ({
    kvlistValue: {
      values: Object.entries(o).map(([key, v]) => ({
        key,
        value: typeof v === "object" ? kv(v as Record<string, unknown>) : { stringValue: String(v) },
      })),
    },
  });

  it("ships a shipper line once with its text, and an SDK line once withheld, even one claiming to be the shipper", async () => {
    await send("shipper", { "service.name": "cms", "k8s.pod.name": "cms-1" }, { stringValue: "Error: migrate failed" });
    await send("sdk", { "service.name": "bff" }, { stringValue: "office text in an SDK log" });
    await send("sdk", { "service.name": "bff-spoof", "collector.log.source": "container" }, { stringValue: "office text, claiming" });
    await waitFor(out, (r) => r.length >= 3);
    await new Promise((r) => setTimeout(r, 1000));
    const got = rows(out);
    const by = (service: string) => got.filter((r) => r.resource["service.name"] === service);
    expect(by("cms").map((r) => r.body)).toEqual(["Error: migrate failed"]);
    expect(by("cms")[0].resource).toMatchObject({ "deployment.environment.name": "dev", "collector.log.source": "container" });
    expect(by("bff").map((r) => r.body)).toEqual([WITHHELD]);
    expect(by("bff-spoof").map((r) => r.body)).toEqual([WITHHELD]);
  }, 20_000);

  it("turns a Warning event into a WARN row with the reason, the object, the pod and its count", async () => {
    await send("events", {}, kv({ type: "DELETED", object: { type: "Normal", reason: "Pulled", note: "expired" } }), 0);
    await send(
      "events",
      {},
      kv({
        type: "ADDED",
        object: {
          type: "Warning",
          reason: "Unhealthy",
          note: "Readiness probe failed: HTTP probe failed with statuscode: 503",
          reportingController: "kubelet",
          regarding: { kind: "Pod", name: "cms-7d9f-abcde", namespace: "cms", fieldPath: "spec.containers{cms}" },
          series: { count: "7" },
        },
      }),
      0,
    );
    const got = await waitFor(out, (r) => r.some((x) => x.attributes["k8s.event.reason"] === "Unhealthy"));
    const event = got.find((r) => r.attributes["k8s.event.reason"] === "Unhealthy");
    expect(event?.body).toBe("Readiness probe failed: HTTP probe failed with statuscode: 503");
    expect(event).toMatchObject({ severity: 13, severityText: "warn" });
    expect(event?.attributes).toMatchObject({
      "k8s.object.kind": "Pod",
      "k8s.object.name": "cms-7d9f-abcde",
      "k8s.event.type": "Warning",
      "k8s.event.count": "7",
    });
    expect(event?.resource).toMatchObject({
      "service.name": "k8s-events",
      "collector.log.source": "k8s.event",
      "k8s.namespace.name": "cms",
      "k8s.pod.name": "cms-7d9f-abcde",
      "deployment.environment.name": "dev",
    });
    expect(got.some((r) => r.body === "expired")).toBe(false);
  }, 20_000);
});
