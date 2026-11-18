import { spawn } from "node:child_process";
import { request } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import workerdPackage from "workerd";

const WORKERD = workerdPackage.default;

const READY_TIMEOUT_MS = 30_000;

function call(socketPath, method, path, body) {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method, path, headers: body ? { "content-type": "application/json", "content-length": body.length } : {} }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(body);
  });
}

export class Slot {
  #child = null;
  #ready = null;
  #stopped = false;

  constructor({ index, root, config, storageRoot }) {
    this.index = index;
    this.socket = join(root, `slot-${index}.sock`);
    this.storage = join(storageRoot, `slot-${index}`);
    this.config = config;
    this.busy = false;
  }

  get ready() {
    return this.#ready !== null && this.#child !== null;
  }

  async start() {
    if (this.#stopped) return;
    await rm(this.socket, { force: true });
    await mkdir(this.storage, { recursive: true });
    const child = spawn(WORKERD, ["serve", "--experimental", this.config, `--socket-addr=http=unix:${this.socket}`, `--directory-path=run-storage=${this.storage}`], { stdio: ["ignore", "inherit", "inherit"] });
    this.#child = child;
    this.#ready = null;
    child.on("exit", () => {
      if (this.#child === child) this.#child = null;
    });
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline && this.#child === child) {
      const health = await call(this.socket, "GET", "/health").catch(() => null);
      if (health?.status === 200) {
        this.#ready = Date.now();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (this.#stopped) return;
    throw new Error(`workerd slot ${this.index} did not become ready`);
  }

  async restart() {
    const child = this.#child;
    this.#child = null;
    this.#ready = null;
    if (child && child.exitCode === null) {
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await rm(this.storage, { recursive: true, force: true });
    await this.start();
  }

  async memoryMiB() {
    const pid = this.#child?.pid;
    if (!pid) return null;
    const status = await readFile(`/proc/${pid}/status`, "utf8").catch(() => "");
    const kib = /^RssAnon:\s+(\d+) kB$/m.exec(status);
    return kib ? Number(kib[1]) / 1024 : null;
  }

  run(body) {
    return call(this.socket, "POST", "/run", body);
  }

  stop() {
    this.#stopped = true;
    this.#child?.kill("SIGTERM");
  }
}
