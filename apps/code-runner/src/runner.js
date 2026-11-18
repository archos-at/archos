import { Buffer } from "node:buffer";
import { DurableObject } from "cloudflare:workers";
import { Workspace } from "@cloudflare/computer";
import { CodemodeBackend } from "@cloudflare/computer/backends/codemode";
import { transform } from "sucrase";
import { LIBRARY_MODULES } from "#libraries";
import { LIMITS, WORKSPACE_ROOT } from "./limits.js";
import { BadRequest, parseRunRequest } from "./request.js";

const MiB = 1024 * 1024;
const SCRIPT_FILE = /\.(c|m)?(j|t)sx?$/;
const decoder = new TextDecoder();

export function librariesFor(source, files) {
  const texts = [source, ...files.filter((file) => SCRIPT_FILE.test(file.path)).map((file) => decoder.decode(file.bytes))];
  const modules = {};
  for (const [name, code] of Object.entries(LIBRARY_MODULES)) {
    if (texts.some((text) => text.includes(`"${name}"`) || text.includes(`'${name}'`) || text.includes(`\`${name}\``))) {
      modules[name] = code;
    }
  }
  return modules;
}

function backend(env, modules) {
  return new CodemodeBackend({
    loader: env.LOADER,
    globalOutbound: null,
    modules,
    defaultTimeoutMs: LIMITS.defaultTimeoutMs,
    maxTimeoutMs: LIMITS.maxTimeoutMs,
    maxCpuMs: LIMITS.maxTimeoutMs,
    maxSourceBytes: 32 * MiB,
    maxInputBytes: LIMITS.maxInputBytes,
    maxResultBytes: LIMITS.maxValueBytes,
    maxStdioBytes: 1 * MiB,
    maxCapabilityBytes: LIMITS.maxInputBytes,
    maxCapabilityRequestBytes: LIMITS.maxInputBytes + LIMITS.maxOutputBytes,
    maxCapabilityResponseBytes: LIMITS.maxInputBytes + LIMITS.maxOutputBytes,
    maxCapabilityCalls: 4096,
    keepAliveIntervalMs: 0,
  });
}

function json(status, body) {
  return Response.json(body, { status });
}

function truncate(text) {
  const value = text ?? "";
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= LIMITS.maxStdioBytes) return value;
  const marker = "\n...[truncated]";
  return decoder.decode(bytes.subarray(0, LIMITS.maxStdioBytes - marker.length)).replace(/�$/, "") + marker;
}

async function sha256(bytes) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
}

function stripTypes(source) {
  return transform(source, { transforms: ["typescript"], disableESTransforms: true }).code;
}

function statusOf(result) {
  if (result.status === "completed" && result.exitCode === 0) return "ok";
  if (/timed out|exceeded (its )?CPU|CPU time limit/i.test(String(result.stderr))) return "timeout";
  return "error";
}

export class Runner extends DurableObject {
  async fetch(request) {
    let run;
    try {
      run = parseRunRequest(await request.json());
    } catch (error) {
      if (error instanceof BadRequest || error instanceof SyntaxError) return json(400, { error: error.message });
      throw error;
    }
    const started = Date.now();
    const ws = new Workspace({ storage: this.ctx.storage, backends: [backend(this.env, librariesFor(run.source, run.files))] });
    try {
      await ws.ready();
      const result = await runIn(ws.stub(), run);
      return json(200, { ...result, durationMs: Date.now() - started });
    } finally {
      await ws.close().catch(() => undefined);
      await this.ctx.storage.deleteAll();
    }
  }
}

async function runIn(ws, run) {
  const sent = new Map();
  await ws.fs.mkdir(WORKSPACE_ROOT, { recursive: true });
  for (const file of run.files) {
    await ws.fs.mkdir(file.path.slice(0, file.path.lastIndexOf("/")), { recursive: true });
    await ws.fs.writeFile(file.path, file.bytes);
    sent.set(file.path, await sha256(file.bytes));
  }
  const outcome = await execute(ws, run);
  const collected = await collectChanged(ws, sent);
  if (collected.error) {
    return { ...outcome, status: "error", stderr: truncate(`${outcome.stderr}${outcome.stderr ? "\n" : ""}${collected.error}`), files: [] };
  }
  return { ...outcome, files: collected.files };
}

async function execute(ws, run) {
  const failed = { status: "error", value: null, stdout: "" };
  let source;
  try {
    source = run.language === "ts" ? stripTypes(run.source) : run.source;
  } catch (error) {
    return { ...failed, stderr: truncate(`TypeScript: ${error.message}`) };
  }
  try {
    const handle = await ws.runtime.exec(source, {
      backend: "codemode",
      encoding: "utf8",
      input: run.input,
      timeoutMs: run.timeoutMs,
    });
    const result = await handle.result();
    return {
      status: statusOf(result),
      value: result.value === undefined ? null : result.value,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
    };
  } catch (error) {
    return { ...failed, stderr: truncate(error instanceof Error ? error.message : String(error)) };
  }
}

async function collectChanged(ws, sent) {
  const entries = await ws.fs.find(WORKSPACE_ROOT, "**", { limit: LIMITS.maxEntries + 1 });
  if (entries.length > LIMITS.maxEntries) return { error: `The run left more than ${LIMITS.maxEntries} entries under ${WORKSPACE_ROOT}/.` };
  const files = [];
  let total = 0;
  for (const entry of entries) {
    if (entry.type !== "file") continue;
    const path = entry.path.startsWith("/") ? entry.path : `${WORKSPACE_ROOT}/${entry.path}`;
    const bytes = new Uint8Array(await new Response(await ws.fs.readFile(path)).arrayBuffer());
    if (sent.get(path) === (await sha256(bytes))) continue;
    total += bytes.byteLength;
    if (total > LIMITS.maxOutputBytes) {
      return { error: `The files the run wrote exceed ${LIMITS.maxOutputBytes} bytes; none are returned.` };
    }
    files.push({ path, base64: Buffer.from(bytes).toString("base64"), size: bytes.byteLength });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files };
}
