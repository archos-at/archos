import { spawn } from "node:child_process";
import { request } from "node:http";
import { readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import workerdPackage from "workerd";

const WORKERD = workerdPackage.default;

const READY_TIMEOUT_MS = 30_000;
const RESTART_BACKOFF_MS = { first: 250, max: 30_000 };
const CRASH_LOOP_MS = 10_000;
const STOP_GRACE_MS = 5_000;
const HEALTH_TIMEOUT_MS = 2_000;
const STDERR_TAIL_BYTES = 8192;
const OUT_OF_MEMORY = /out of memory|heap limit|allocation failed|bad_alloc/i;

export function collector(declaredLength) {
  const length = Number(declaredLength);
  const into = declaredLength !== undefined && Number.isSafeInteger(length) && length >= 0 ? Buffer.allocUnsafe(length) : null;
  let chunks = [];
  let size = 0;
  return {
    get size() {
      return size;
    },
    add(chunk) {
      if (into && size + chunk.length <= length) chunk.copy(into, size);
      else chunks.push(chunk);
      size += chunk.length;
    },
    bytes() {
      if (into && size === length) return into;
      if (into) chunks = [into.subarray(0, Math.min(size, length)), ...chunks];
      return Buffer.concat(chunks);
    },
  };
}

function call(socketPath, method, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method, path, headers: body ? { "content-type": "application/json", "content-length": body.length } : {} }, (res) => {
      const body = collector(res.headers["content-length"]);
      res.on("data", (chunk) => body.add(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: body.bytes() }));
      res.on("error", reject);
    });
    req.on("error", reject);
    if (timeoutMs) req.setTimeout(timeoutMs, () => req.destroy(new Error(`${method} ${path} took longer than ${timeoutMs} ms`)));
    req.end(body);
  });
}

export function anonymousMemoryBytes(pid) {
  if (!pid) return null;
  try {
    const kib = /^RssAnon:\s+(\d+) kB$/m.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return kib ? Number(kib[1]) * 1024 : null;
  } catch {
    return null;
  }
}

export class Slot {
  #child = null;
  #last = null;
  #ready = false;
  #stopped = false;
  #pending = null;
  #timer = null;
  #failures = 0;
  #startedAt = 0;
  #stderrTail = "";

  constructor({ index, root, config, storageRoot, log = () => {}, browserAddr }) {
    this.browserAddr = browserAddr || null;
    this.index = index;
    this.socket = join(root, `slot-${index}.sock`);
    this.storage = join(storageRoot, `slot-${index}`);
    this.config = config;
    this.log = log;
    this.busy = false;
  }

  get ready() {
    return this.#ready && this.#child !== null;
  }

  get pid() {
    return this.#child?.pid ?? null;
  }

  async diedOfMemory(waitMs = 1000) {
    const child = this.#last;
    if (child && !child.stderr.readableEnded) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, waitMs);
        child.stderr.once("end", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return OUT_OF_MEMORY.test(this.#stderrTail);
  }

  memoryBytes() {
    return anonymousMemoryBytes(this.pid);
  }

  async start() {
    await rm(this.socket, { force: true });
    await mkdir(this.storage, { recursive: true });
    if (this.#stopped) return;
    const browser = this.browserAddr ? [`--external-addr=browser-renderer=${this.browserAddr}`] : [];
    const args = ["serve", "--experimental", this.config, `--socket-addr=http=unix:${this.socket}`, `--directory-path=run-storage=${this.storage}`, ...browser];
    const env = { ...process.env, BROWSER_RENDERER_ADDR: this.browserAddr ?? "" };
    const child = spawn(WORKERD, args, { stdio: ["ignore", "inherit", "pipe"], env });
    this.#child = child;
    this.#last = child;
    this.#ready = false;
    this.#startedAt = Date.now();
    this.#stderrTail = "";
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      this.#stderrTail = (this.#stderrTail + chunk.toString()).slice(-STDERR_TAIL_BYTES);
    });
    child.on("exit", (code, signal) => this.#exited(child, code, signal));
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline && this.#child === child && !this.#stopped) {
      const health = await call(this.socket, "GET", "/health", undefined, HEALTH_TIMEOUT_MS).catch(() => null);
      if (health?.status === 200) {
        this.baselineBytes = this.memoryBytes() ?? 0;
        this.#ready = true;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (this.#stopped) return;
    if (this.#child === child) child.kill("SIGKILL");
    throw new Error(`workerd slot ${this.index} did not become ready`);
  }

  #exited(child, code, signal) {
    if (this.#child !== child) return;
    this.#child = null;
    this.#ready = false;
    if (this.#stopped || this.busy || this.#pending) return;
    if (Date.now() - this.#startedAt >= CRASH_LOOP_MS) this.#failures = 0;
    this.log({ message: "slot exited while idle", slot: this.index, code, signal });
    this.#schedule();
  }

  #schedule() {
    if (this.#stopped || this.#timer) return;
    const delay = Math.min(RESTART_BACKOFF_MS.first * 2 ** this.#failures, RESTART_BACKOFF_MS.max);
    this.#failures += 1;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.restart().catch(() => undefined);
    }, delay);
  }

  restart() {
    clearTimeout(this.#timer);
    this.#timer = null;
    this.#pending ??= this.#replace().finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }

  async #replace() {
    const child = this.#child;
    this.#child = null;
    this.#ready = false;
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
    }
    if (this.#stopped) return;
    await rm(this.storage, { recursive: true, force: true });
    try {
      await this.start();
    } catch (error) {
      this.log({ message: "slot restart failed", slot: this.index, error: String(error) });
      this.#schedule();
      throw error;
    }
  }

  run(body) {
    return call(this.socket, "POST", "/run", body);
  }

  async stop() {
    this.#stopped = true;
    clearTimeout(this.#timer);
    await this.#pending?.catch(() => undefined);
    const child = this.#child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    const killer = setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS);
    await exited;
    clearTimeout(killer);
  }
}
