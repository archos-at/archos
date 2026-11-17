import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dump } from "js-yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POSTHOG_LOG_ATTRIBUTES, POSTHOG_LOG_REDACTION, WITHHELD, posthogLogs } from "./otel-collector";

/**
 * No office text reaches PostHog Logs (configs/subprocessors/posthog.yaml).
 *
 * The positive control: a WARN line naming a document and quoting a licensed
 * norm goes through the real collector, with the processors the PostHog logs
 * pipeline runs, into a file exporter that stands in for PostHog. Neither the
 * name nor the quote may arrive; the area tag, the severity and the code
 * location must. A collector that cannot run the statements fails the spec
 * instead of exporting the line as it came.
 *
 * Needs `OTELCOL_BIN` (CI's infra job installs the pinned build), like
 * `collector-validate.spec.ts`; without it the end-to-end half is skipped.
 */

const OTELCOL_BIN = process.env.OTELCOL_BIN;
const DOCUMENT = "Gutachten_Brandschutz_Mueller_Haus7.pdf";
const LICENSED = "Fluchtwege sind so anzuordnen, dass sie von jeder Stelle eines Raumes erreichbar sind";

describe("the PostHog logs pipeline", () => {
  it("runs the redaction after the severity filter and before the exporter", () => {
    const fragment = posthogLogs("https://eu.i.posthog.com", "phc_test");
    expect(fragment.pipelines?.["logs/posthog"]?.processors).toEqual(["filter/warn_and_above", "transform/posthog_redact"]);
    expect(fragment.processors?.["transform/posthog_redact"]).toBe(POSTHOG_LOG_REDACTION);
  });

  it("keeps no attribute that carries a message", () => {
    expect(POSTHOG_LOG_ATTRIBUTES).not.toContain("exception.message");
    expect(POSTHOG_LOG_ATTRIBUTES).not.toContain("exception.stacktrace");
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

function logRecord(body: string, attributes: Record<string, string>) {
  return {
    severityNumber: 13,
    severityText: "WARN",
    body: { stringValue: body },
    attributes: Object.entries(attributes).map(([key, value]) => ({ key, value: { stringValue: value } })),
  };
}

describe.skipIf(!OTELCOL_BIN)("the real collector withholds office text from PostHog", () => {
  let collector: ChildProcess;
  let port: number;
  let out: string;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "posthog-redact-"));
    out = join(dir, "exported.jsonl");
    port = await freePort();
    const fragment = posthogLogs("https://eu.i.posthog.com", "phc_test");
    const config = {
      receivers: { otlp: { protocols: { http: { endpoint: `127.0.0.1:${port}` } } } },
      processors: fragment.processors,
      exporters: { file: { path: out } },
      service: {
        telemetry: { metrics: { level: "none" } },
        pipelines: {
          logs: { receivers: ["otlp"], processors: ["filter/warn_and_above", "transform/posthog_redact"], exporters: ["file"] },
        },
      },
    };
    const file = join(dir, "collector.yaml");
    writeFileSync(file, dump(config));
    let stderr = "";
    collector = spawn(OTELCOL_BIN!, [`--config=${file}`], { stdio: ["ignore", "ignore", "pipe"] });
    collector.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    for (let i = 0; i < 100; i += 1) {
      const up = await fetch(`http://127.0.0.1:${port}/v1/logs`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
        .then(() => true)
        .catch(() => false);
      if (up) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`the collector did not start:\n${stderr.slice(-2000)}`);
  }, 20_000);

  afterAll(() => {
    collector?.kill();
  });

  it("drops the document name and the licensed passage, keeps tag, severity and code location", async () => {
    const payload = {
      resourceLogs: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "bff" } }] },
          scopeLogs: [
            {
              scope: { name: "documents.purge" },
              logRecords: [
                logRecord(`[documents] chunk purge refused for org-1/${DOCUMENT}: ${LICENSED}`, {
                  "code.function": "purgeChunks",
                  "document.name": DOCUMENT,
                  "exception.message": `cannot read ${DOCUMENT}`,
                  "exception.type": "PurgeRefused",
                }),
                logRecord(`Traceback: quoted "${LICENSED}" from ${DOCUMENT}`, { "code.lineno": "42" }),
              ],
            },
          ],
        },
      ],
    };
    const response = await fetch(`http://127.0.0.1:${port}/v1/logs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(200);
    let exported = "";
    for (let i = 0; i < 50 && !exported.includes("PurgeRefused"); i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      exported = existsSync(out) ? readFileSync(out, "utf8") : "";
    }
    expect(exported).toContain("PurgeRefused");
    expect(exported).toContain(`[documents] ${WITHHELD}`);
    expect(exported).toContain("purgeChunks");
    expect(exported).toContain("documents.purge");
    expect(exported).not.toContain("Mueller");
    expect(exported).not.toContain("Fluchtwege");
    expect(exported).not.toContain("document.name");
  }, 20_000);
});
