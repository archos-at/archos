import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../bin/server.mjs";

export async function startRunner({ slots = 8, ...options } = {}) {
  const storage = await mkdtemp(join(tmpdir(), "code-runner-do-"));
  const server = await startServer({ port: 0, host: "127.0.0.1", slots, storage, ...options });
  const url = `http://127.0.0.1:${server.port}`;
  return {
    url,
    storage,
    slots: server.slots,
    async run(body) {
      const response = await fetch(`${url}/run`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
      return { http: response.status, body: await response.json() };
    },
    async runWhenFree(body, timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const result = await this.run(body);
        if (result.http !== 503 || Date.now() > deadline) return result;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    async stop() {
      await server.close();
      await rm(storage, { recursive: true, force: true });
    },
  };
}

export const b64 = (text) => Buffer.from(text).toString("base64");
export const fromB64 = (base64) => Buffer.from(base64, "base64");

export function returned(body, path) {
  const file = body.files.find((entry) => entry.path === path);
  if (!file) throw new Error(`${path} not returned; got ${body.files.map((entry) => entry.path).join(", ") || "none"}. stderr: ${body.stderr}`);
  return fromB64(file.base64);
}
