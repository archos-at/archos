import { Buffer } from "node:buffer";
import { DurableObject } from "cloudflare:workers";
import { Workspace } from "@cloudflare/computer";
import { CodemodeBackend } from "@cloudflare/computer/backends/codemode";
import { transform } from "sucrase";
import { LIBRARY_MODULES, LIBRARY_SPECIFIERS, TYPST, WASM_MODULES } from "#libraries";
import { browserHost } from "./browser/host.js";
import TYPST_COMPILER from "./typst-compiler.wasm";
import TYPST_FILES from "./typst-files.bin";
import { LIMITS, WORKSPACE_ROOT } from "./limits.js";
import { BadRequest, parseRunRequest } from "./request.js";

const MiB = 1024 * 1024;
const SCRIPT_FILE = /\.(c|m)?(j|t)sx?$/;
const BROWSER_MODULE = "cloudflare-puppeteer";
const decoder = new TextDecoder();

const quoted = (text, name) => text.includes(`"${name}"`) || text.includes(`'${name}'`) || text.includes(`\`${name}\``);

export function librariesFor(source, files) {
  const texts = [source, ...files.filter((file) => SCRIPT_FILE.test(file.path)).map((file) => decoder.decode(file.bytes))];
  const aliases = Object.entries(LIBRARY_SPECIFIERS);
  const modules = {};
  for (const [name, code] of Object.entries(LIBRARY_MODULES)) {
    const names = [name, ...aliases.filter(([, module]) => module === name).map(([specifier]) => specifier)];
    if (texts.some((text) => names.some((candidate) => quoted(text, candidate)))) modules[name] = code;
  }
  return modules;
}

export function renameSpecifiers(source) {
  let renamed = source;
  for (const [specifier, name] of Object.entries(LIBRARY_SPECIFIERS)) {
    if (specifier === name) continue;
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    renamed = renamed.replace(new RegExp(`(\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\bimport\\s+)(["'\`])${escaped}\\2`, "g"), `$1$2${name}$2`);
  }
  return renamed;
}

const BINARY_MODULE = "export default null;";

export function withBinaryModules(loader, binaries) {
  if (Object.keys(binaries).length === 0) return loader;
  return {
    load(config) {
      const modules = { ...config.modules };
      for (const [name, module] of Object.entries(binaries)) {
        const stored = Object.keys(modules).find((key) => key === name || key.endsWith(`/${name}`));
        if (stored !== undefined) modules[stored] = module;
      }
      return loader.load({ ...config, modules });
    },
  };
}

const BINARIES = {
  ...WASM_MODULES,
  [TYPST.module]: { [TYPST.compiler]: { wasm: TYPST_COMPILER }, [TYPST.files]: { data: TYPST_FILES } },
};

function binariesFor(modules) {
  const binaries = {};
  for (const [library, files] of Object.entries(BINARIES)) {
    if (!Object.hasOwn(modules, library)) continue;
    for (const [name, module] of Object.entries(files)) {
      modules[name] = BINARY_MODULE;
      binaries[name] = module;
    }
  }
  return binaries;
}

function backend(env, modules, browser) {
  const binaries = binariesFor(modules);
  return new CodemodeBackend({
    loader: withBinaryModules(env.LOADER, binaries),
    globalOutbound: null,
    modules: modules[BROWSER_MODULE] ? { ...modules, "codemode:browser": browser.module } : modules,
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
    const browser = browserHost(this.env);
    const ws = new Workspace({ storage: this.ctx.storage, backends: [backend(this.env, librariesFor(run.source, run.files), browser)] });
    try {
      await ws.ready();
      const result = await runIn(ws.stub(), run);
      if (browser.state.busy && result.status === "error") return json(503, { error: "busy" });
      return json(200, { ...result, durationMs: Date.now() - started });
    } finally {
      browser.closeAll();
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
    source = renameSpecifiers(run.language === "ts" ? stripTypes(run.source) : run.source);
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
