import { createServer } from "node:http";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Slot } from "./slot.mjs";
import { sweep } from "./sweep.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MiB = 1024 * 1024;
const MAX_BODY_BYTES = 72 * MiB;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 180_000;
const SWEEP_EVERY_MS = 60_000;

const WATCHDOG_GRACE_MS = 10_000;

function send(res, status, body, type = "application/json") {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  res.writeHead(status, { "content-type": type, "content-length": payload.length });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function deadlineOf(body, grace) {
  try {
    const timeoutMs = JSON.parse(body).timeoutMs;
    if (typeof timeoutMs === "number" && timeoutMs > 0 && timeoutMs <= MAX_TIMEOUT_MS) return timeoutMs + grace;
  } catch {
    return grace;
  }
  return DEFAULT_TIMEOUT_MS + grace;
}

function stopped(status, started, stderr) {
  return { status, value: null, stdout: "", stderr, files: [], durationMs: Date.now() - started };
}

async function runOn(slot, body, grace) {
  const started = Date.now();
  let timer;
  const watchdog = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), deadlineOf(body, grace));
  });
  try {
    const answer = await Promise.race([slot.run(body), watchdog]).catch(() => undefined);
    if (answer) return { answer, restart: false };
    const result = answer === null
      ? stopped("timeout", started, "The run did not stop at its time limit, so its runtime was stopped.\n")
      : stopped("error", started, "The runtime stopped during the run.\n");
    return { answer: { status: 200, body: Buffer.from(JSON.stringify(result)) }, restart: true };
  } finally {
    clearTimeout(timer);
  }
}

export async function startServer({ port, host, slots: count, storage, watchdogGraceMs = WATCHDOG_GRACE_MS, browserAddr }) {
  await mkdir(storage, { recursive: true });
  const sockets = await mkdtemp(join(tmpdir(), "code-runner-"));
  const config = join(ROOT, "config.capnp");
  const slots = Array.from({ length: count }, (_, index) => new Slot({ index, root: sockets, config, storageRoot: storage, browserAddr }));
  await Promise.all(slots.map((slot) => slot.start()));

  async function handleRun(req, res) {
    const slot = slots.find((candidate) => !candidate.busy && candidate.ready);
    if (!slot) return send(res, 503, { error: "busy" });
    slot.busy = true;
    let restart = false;
    try {
      const body = await readBody(req).catch(() => null);
      if (body === null) return send(res, 400, { error: `The request body exceeds ${MAX_BODY_BYTES} bytes.` });
      const outcome = await runOn(slot, body, watchdogGraceMs);
      restart = outcome.restart;
      return send(res, outcome.answer.status, outcome.answer.body);
    } finally {
      if (restart) await slot.restart().catch((error) => console.error(JSON.stringify({ message: "slot restart failed", slot: slot.index, error: String(error) })));
      slot.busy = false;
    }
  }

  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://runner");
    if (pathname === "/health") {
      if (req.method !== "GET") return send(res, 405, { error: "Use GET." });
      return slots.some((slot) => slot.ready) ? send(res, 200, "ok", "text/plain") : send(res, 503, "starting", "text/plain");
    }
    if (pathname !== "/run") return send(res, 404, { error: "Not found. POST /run or GET /health." });
    if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
    handleRun(req, res).catch((error) => {
      console.error(JSON.stringify({ message: "run failed", error: String(error) }));
      if (!res.headersSent) send(res, 500, { error: "internal" });
    });
  });
  server.requestTimeout = 0;
  await new Promise((resolve) => server.listen(port, host, resolve));
  const sweeper = setInterval(() => {
    sweep(storage).catch((error) => console.error(JSON.stringify({ message: "sweep failed", error: String(error) })));
  }, SWEEP_EVERY_MS);

  return {
    port: server.address().port,
    async close() {
      clearInterval(sweeper);
      await new Promise((resolve) => server.close(resolve));
      for (const slot of slots) slot.stop();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startServer({
    port: Number(process.env.PORT ?? 8080),
    host: process.env.HOST ?? "0.0.0.0",
    slots: Number(process.env.CODE_RUNNER_SLOTS ?? 4),
    storage: process.env.CODE_RUNNER_STORAGE_DIR ?? "/run/code-runner/do",
    browserAddr: process.env.BROWSER_RENDERER_ADDR,
  });
  console.log(JSON.stringify({ message: "code runner listening", port: server.port }));
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, async () => {
      await server.close();
      process.exit(0);
    });
  }
}
