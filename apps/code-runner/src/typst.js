import { initSync, TypstCompilerBuilder } from "@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler.mjs";
import compilerModule from "./typst-compiler.wasm";
import bundle from "./typst-files.bin";
import { FONTS, PACKAGES } from "#typst-index";

const PDF_FORMAT = 1;
const UNIX_DIAGNOSTICS = 2;
const ROOT = "/doc";
const encoder = new TextEncoder();
let compiler;

function slice([offset, length]) {
  return new Uint8Array(bundle, offset, length);
}

function bytesOf(value) {
  if (typeof value === "string") return encoder.encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("A Typst file is a string, a Uint8Array or an ArrayBuffer.");
}

function normalise(name) {
  const parts = [];
  for (const part of String(name).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") throw new Error(`Typst file names stay inside the document: ${name}`);
    parts.push(part);
  }
  return `${ROOT}/${parts.join("/")}`;
}

class Files {
  constructor() {
    this.entries = new Map();
  }
  put(path, data) {
    this.entries.set(path, data);
  }
  clear() {
    for (const path of [...this.entries.keys()]) if (path.startsWith(`${ROOT}/`)) this.entries.delete(path);
  }
}

const files = new Files();

function resolvePackage(spec) {
  if (spec.namespace !== "preview") return undefined;
  const key = `${spec.name}:${spec.version}`;
  const at = PACKAGES[key];
  if (!at) return undefined;
  const dir = `/packages/preview/${spec.name}/${spec.version}`;
  if (!files.entries.has(`${dir}/typst.toml`)) {
    this.untar(slice(at), (path, data) => files.put(`${dir}/${path}`, data));
  }
  return dir;
}

async function build() {
  initSync({ module: compilerModule });
  const builder = new TypstCompilerBuilder();
  await builder.set_access_model(
    files,
    (path) => (files.entries.has(path) ? 1 : 0),
    (path) => files.entries.has(path),
    (path) => path,
    (path) => files.entries.get(path),
  );
  await builder.set_package_registry(files, resolvePackage);
  for (const at of FONTS) await builder.add_raw_font(slice(at));
  return builder.build();
}

function failure(diagnostics) {
  const lines = (diagnostics ?? []).map((d) => {
    if (typeof d === "string") return d;
    const where = d.path ? `${String(d.path).replace(`${ROOT}/`, "")}:${d.range ?? ""} ` : "";
    return `${d.severity ?? "error"}: ${where}${d.message ?? JSON.stringify(d)}`;
  });
  return new Error(`Typst could not compile the document.\n${lines.join("\n") || "no diagnostics"}`);
}

export async function compile(source, options = {}) {
  compiler ??= await build();
  files.clear();
  files.put(normalise("main.typ"), encoder.encode(String(source)));
  for (const [name, value] of Object.entries(options.files ?? {})) files.put(normalise(name), bytesOf(value));
  compiler.reset();
  const inputs = Object.entries(options.inputs ?? {}).map(([key, value]) => [key, String(value)]);
  const world = compiler.snapshot(ROOT, normalise("main.typ"), inputs.length ? inputs : null);
  let output;
  try {
    output = world.get_artifact(PDF_FORMAT, UNIX_DIAGNOSTICS);
  } catch (error) {
    throw failure(Array.isArray(error) ? error : [String(error?.message ?? error)]);
  } finally {
    world.free();
  }
  if (!output?.result) throw failure(output?.diagnostics);
  return output.result;
}

export default { compile };
