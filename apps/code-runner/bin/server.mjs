import { createServer } from "node:http";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Slot, collector } from "./slot.mjs";
import { sweep } from "./sweep.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MiB = 1024 * 1024;
const MAX_BODY_BYTES = 72 * MiB;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 180_000;
const SWEEP_EVERY_MS = 60_000;

const WATCHDOG_GRACE_MS = 10_000;
const BODY_TIMEOUT_MS = 30_000;
const DEFAULT_SLOT_MEMORY_MIB = 768;
const RECYCLE_ABOVE_MIB = 128;
const MEMORY_POLL_MS = 25;

function log(entry) {
  console.error(JSON.stringify(entry));
}

class RequestRefused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, type = "application/json") {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  res.writeHead(status, { "content-type": type, "content-length": payload.length });
  res.end(payload);
}

function readBody(req, { timeoutMs, budget }) {
  return new Promise((resolve, reject) => {
    const declared = req.headers["content-length"] === undefined ? null : Number(req.headers["content-length"]);
    let reserved = 0;
    let body = null;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      budget.release(reserved);
      if (error) {
        req.removeAllListeners("data");
        req.resume();
        reject(error);
      } else resolve(value);
    };
    const timer = setTimeout(() => finish(new RequestRefused(408, `The request body did not arrive within ${timeoutMs} ms.`)), timeoutMs);
    const tooLarge = () => finish(new RequestRefused(400, `The request body exceeds ${MAX_BODY_BYTES} bytes.`));
    if (declared !== null && declared > MAX_BODY_BYTES) return tooLarge();
    if (declared !== null && !budget.take(declared)) return finish(new RequestRefused(503, "busy"));
    reserved = declared ?? 0;
    body = collector(req.headers["content-length"]);
    req.on("data", (chunk) => {
      if (settled) return;
      if (body.size + chunk.length > MAX_BODY_BYTES) return tooLarge();
      if (declared === null) {
        if (!budget.take(chunk.length)) return finish(new RequestRefused(503, "busy"));
        reserved += chunk.length;
      }
      body.add(chunk);
    });
    req.on("end", () => finish(null, body.bytes()));
    req.on("error", (error) => finish(error));
  });
}

function byteBudget(limit) {
  let used = 0;
  return {
    take(bytes) {
      if (used + bytes > limit) return false;
      used += bytes;
      return true;
    },
    release(bytes) {
      used -= bytes;
    },
  };
}

function parseRequest(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new RequestRefused(400, `The body is not JSON: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new RequestRefused(400, "The body must be a JSON object.");
  const timeoutMs = parsed.timeoutMs;
  return { timeoutMs: typeof timeoutMs === "number" && timeoutMs > 0 && timeoutMs <= MAX_TIMEOUT_MS ? timeoutMs : DEFAULT_TIMEOUT_MS };
}

function stopped(status, started, stderr) {
  const result = { status, value: null, stdout: "", stderr, files: [], durationMs: Date.now() - started };
  return { status: 200, body: Buffer.from(JSON.stringify(result)) };
}

function watchMemory(slot, limitBytes) {
  let timer;
  const exceeded = new Promise((resolve) => {
    timer = setInterval(() => {
      if ((slot.memoryBytes() ?? 0) > limitBytes) resolve("memory");
    }, MEMORY_POLL_MS);
  });
  return { exceeded, stop: () => clearInterval(timer) };
}

async function runOn(slot, body, deadlineMs, limitBytes) {
  const started = Date.now();
  let timer;
  const watchdog = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), deadlineMs);
  });
  const memory = watchMemory(slot, limitBytes);
  try {
    const answer = await Promise.race([slot.run(body), watchdog, memory.exceeded]).catch(async () => ((await slot.diedOfMemory()) ? "memory" : "stopped"));
    if (typeof answer === "object") return { answer, failed: false };
    const limitMiB = Math.round(limitBytes / MiB);
    const messages = {
      timeout: ["timeout", "The run did not stop at its time limit, so its runtime was stopped.\n"],
      memory: ["error", `The run used more memory than allowed (${limitMiB} MiB), so its runtime was stopped.\n`],
      stopped: ["error", "The runtime stopped during the run.\n"],
    };
    const [status, stderr] = messages[answer];
    log({ message: "run stopped", slot: slot.index, reason: answer });
    return { answer: stopped(status, started, stderr), failed: true };
  } finally {
    clearTimeout(timer);
    memory.stop();
  }
}

export async function startServer({
  port,
  host,
  slots: count,
  storage,
  watchdogGraceMs = WATCHDOG_GRACE_MS,
  bodyTimeoutMs = BODY_TIMEOUT_MS,
  slotMemoryMiB = DEFAULT_SLOT_MEMORY_MIB,
  browserAddr,
}) {
  await mkdir(storage, { recursive: true });
  const sockets = await mkdtemp(join(tmpdir(), "code-runner-"));
  const config = join(ROOT, "config.capnp");
  const slots = Array.from({ length: count }, (_, index) => new Slot({ index, root: sockets, config, storageRoot: storage, log, browserAddr }));
  await Promise.all(slots.map((slot) => slot.start()));
  const limitBytes = slotMemoryMiB * MiB;
  const recycleBytes = RECYCLE_ABOVE_MIB * MiB;
  const budget = byteBudget(2 * MAX_BODY_BYTES);
  const freeSlot = () => slots.find((candidate) => !candidate.busy && candidate.ready);
  const healthy = () => slots.filter((slot) => slot.ready).length >= Math.ceil(count / 2);

  async function restart(slot) {
    await slot.restart().catch(() => undefined);
  }

  async function handleRun(req, res) {
    if (!freeSlot()) return send(res, 503, { error: "busy" });
    let request;
    let body;
    try {
      body = await readBody(req, { timeoutMs: bodyTimeoutMs, budget });
      request = parseRequest(body);
    } catch (error) {
      if (!(error instanceof RequestRefused)) throw error;
      res.once("finish", () => req.destroy());
      return send(res, error.status, { error: error.message });
    }
    const slot = freeSlot();
    if (!slot) return send(res, 503, { error: "busy" });
    slot.busy = true;
    try {
      const outcome = await runOn(slot, body, request.timeoutMs + watchdogGraceMs, limitBytes);
      if (outcome.failed) await restart(slot);
      send(res, outcome.answer.status, outcome.answer.body);
      if (!outcome.failed && (slot.memoryBytes() ?? 0) > (slot.baselineBytes ?? 0) + recycleBytes) await restart(slot);
    } finally {
      slot.busy = false;
    }
  }

  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://runner");
    if (pathname === "/health") {
      if (req.method !== "GET") return send(res, 405, { error: "Use GET." });
      return healthy() ? send(res, 200, "ok", "text/plain") : send(res, 503, "unavailable", "text/plain");
    }
    if (pathname !== "/run") return send(res, 404, { error: "Not found. POST /run or GET /health." });
    if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
    handleRun(req, res).catch((error) => {
      console.error(JSON.stringify({ message: "run failed", error: String(error) }));
      if (!res.headersSent) send(res, 500, { error: "internal" });
    });
  });
  server.headersTimeout = Math.min(bodyTimeoutMs, 60_000);
  server.requestTimeout = bodyTimeoutMs + 1000;
  await new Promise((resolve) => server.listen(port, host, resolve));
  const sweeper = setInterval(() => {
    sweep(storage).catch((error) => console.error(JSON.stringify({ message: "sweep failed", error: String(error) })));
  }, SWEEP_EVERY_MS);

  return {
    port: server.address().port,
    slots,
    async close() {
      clearInterval(sweeper);
      await new Promise((resolve) => server.close(resolve));
      await Promise.all(slots.map((slot) => slot.stop()));
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startServer({
    port: Number(process.env.PORT ?? 8080),
    host: process.env.HOST ?? "0.0.0.0",
    slots: Number(process.env.CODE_RUNNER_SLOTS ?? 4),
    slotMemoryMiB: Number(process.env.CODE_RUNNER_SLOT_MEMORY_MIB ?? DEFAULT_SLOT_MEMORY_MIB),
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
